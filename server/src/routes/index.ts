import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { getRepo } from '../db/repo';
import { ApiError } from '../errors';
import { getEngine } from '../llm';
import {
  pauseDiscussionRuntime,
  resumeDiscussionRuntime,
  startDiscussionRuntime,
  stopDiscussionRuntime,
} from '../engine/orchestrator';
import { generatePanel } from '../services/panelService';
import { registerStreamRoute } from './stream';

/**
 * REST 路由。
 *
 * 约定：路由层只做「校验 + 状态机检查 + 调用服务」，业务逻辑一律不写在这里。
 * 大模型密钥从不出现在任何响应里 —— /health 只暴露 provider / model / 是否为模拟模式。
 */

const router = Router();

/** 把 async handler 的异常转交给 Express 错误中间件。 */
function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req as T, res, next).catch(next);
  };
}

/** 取路径参数：Express 的类型允许 undefined，这里统一收口成必填字符串。 */
function pathParam(req: Request, key: string): string {
  const value = req.params[key];
  if (typeof value !== 'string' || value === '') {
    throw ApiError.notFound('资源不存在');
  }
  return value;
}

// ---------------------------------------------------------------- 健康检查

router.get('/health', (_req, res) => {
  const engine = getEngine();
  res.json({
    status: 'ok',
    llm: {
      provider: config.llm.provider,
      model: engine.model,
      mock: engine.mock,
    },
    now: Date.now(),
  });
});

// ---------------------------------------------------------------- 预置议题

router.get('/preset-topics', (_req, res) => {
  res.json({ items: getRepo().listPresets() });
});

// ---------------------------------------------------------------- 讨论列表

const listQuerySchema = z.object({
  status: z.enum(['live', 'ready', 'ended', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get('/discussions', (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    res.json({ items: getRepo().listSummaries({ status: query.status, limit: query.limit }) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- 创建讨论

const createDiscussionSchema = z.object({
  topic: z.string().trim().min(2, '议题至少 2 个字').max(200, '议题最多 200 个字'),
  background: z.string().trim().max(500, '背景最多 500 个字').optional().nullable(),
  expertCount: z.number().int().min(2).max(6).default(4),
});

router.post(
  '/discussions',
  asyncHandler(async (req, res) => {
    const parsed = createDiscussionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.validation('请求参数不合法', parsed.error.flatten());
    }
    const repo = getRepo();
    const discussion = repo.createDiscussion({
      topic: parsed.data.topic,
      background: parsed.data.background ?? null,
      expertCount: parsed.data.expertCount,
      maxTurns: config.engine.maxTurns,
    });
    res.status(201).json(discussion);
  }),
);

// ---------------------------------------------------------------- 讨论详情

router.get(
  '/discussions/:id',
  asyncHandler(async (req, res) => {
    const detail = getRepo().getDetail(pathParam(req, 'id'));
    if (!detail) throw ApiError.notFound('讨论不存在');
    res.json(detail);
  }),
);

router.get(
  '/discussions/:id/transcript',
  asyncHandler(async (req, res) => {
    const repo = getRepo();
    const discussion = repo.getDiscussion(pathParam(req, 'id'));
    if (!discussion) throw ApiError.notFound('讨论不存在');
    const since = Number.parseInt(String(req.query.since ?? '0'), 10) || 0;
    res.json({ items: repo.getTranscript(pathParam(req, 'id'), since), lastSeq: repo.lastSeq(pathParam(req, 'id')) });
  }),
);

router.delete(
  '/discussions/:id',
  asyncHandler(async (req, res) => {
    const repo = getRepo();
    const discussion = repo.getDiscussion(pathParam(req, 'id'));
    if (!discussion) throw ApiError.notFound('讨论不存在');
    await stopDiscussionRuntime(pathParam(req, 'id'));
    repo.deleteDiscussion(pathParam(req, 'id'));
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------- 阵容

router.post(
  '/discussions/:id/panel',
  asyncHandler(async (req, res) => {
    const repo = getRepo();
    const panelists = await generatePanel(pathParam(req, 'id'), repo);
    res.status(201).json({
      discussionId: pathParam(req, 'id'),
      status: repo.getDiscussion(pathParam(req, 'id'))?.status ?? 'ready',
      panelists,
    });
  }),
);

const panelistPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(20).optional(),
    title: z.string().trim().min(1).max(40).optional(),
    org: z.string().trim().max(60).nullable().optional(),
    stance: z.string().trim().min(1).max(200).optional(),
    bio: z.string().trim().max(200).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是 #RRGGBB 格式')
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个待更新字段' });

router.patch(
  '/discussions/:id/panel/:panelistId',
  asyncHandler(async (req, res) => {
    const parsed = panelistPatchSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.validation('请求参数不合法', parsed.error.flatten());

    const repo = getRepo();
    const discussion = repo.getDiscussion(pathParam(req, 'id'));
    if (!discussion) throw ApiError.notFound('讨论不存在');
    if (discussion.status !== 'draft' && discussion.status !== 'ready') {
      throw ApiError.invalidState('讨论已开始或已结束，无法再修改阵容');
    }

    const existing = repo.getPanelist(pathParam(req, 'panelistId'));
    if (!existing || existing.discussionId !== pathParam(req, 'id')) throw ApiError.notFound('嘉宾不存在');

    const updated = repo.updatePanelist(pathParam(req, 'panelistId'), parsed.data);
    res.json(updated);
  }),
);

// ---------------------------------------------------------------- 生命周期

function requireDiscussion(id: string) {
  const discussion = getRepo().getDiscussion(id);
  if (!discussion) throw ApiError.notFound('讨论不存在');
  return discussion;
}

router.post(
  '/discussions/:id/start',
  asyncHandler(async (req, res) => {
    const repo = getRepo();
    const discussion = requireDiscussion(pathParam(req, 'id'));
    if (discussion.status !== 'ready') {
      throw ApiError.invalidState(
        discussion.status === 'draft' ? '请先生成嘉宾阵容' : '讨论已开始或已结束，无法重复启动',
      );
    }

    repo.updateDiscussion(pathParam(req, 'id'), { startedAt: Date.now() });
    startDiscussionRuntime(pathParam(req, 'id'), repo);

    const updated = repo.getDiscussion(pathParam(req, 'id'));
    res.json({ id: updated?.id, status: updated?.status, phase: updated?.phase, round: updated?.round });
  }),
);

router.post(
  '/discussions/:id/pause',
  asyncHandler(async (req, res) => {
    const repo = getRepo();
    const discussion = requireDiscussion(pathParam(req, 'id'));
    if (discussion.status !== 'live') throw ApiError.invalidState('只有进行中的讨论可以暂停');
    pauseDiscussionRuntime(pathParam(req, 'id'));
    const updated = repo.updateDiscussion(pathParam(req, 'id'), { status: 'paused' });
    res.json({ id: updated?.id, status: updated?.status });
  }),
);

router.post(
  '/discussions/:id/resume',
  asyncHandler(async (req, res) => {
    const repo = getRepo();
    const discussion = requireDiscussion(pathParam(req, 'id'));
    if (discussion.status !== 'paused') throw ApiError.invalidState('只有已暂停的讨论可以继续');
    resumeDiscussionRuntime(pathParam(req, 'id'));
    const updated = repo.updateDiscussion(pathParam(req, 'id'), { status: 'live' });
    res.json({ id: updated?.id, status: updated?.status });
  }),
);

router.post(
  '/discussions/:id/stop',
  asyncHandler(async (req, res) => {
    const repo = getRepo();
    const discussion = requireDiscussion(pathParam(req, 'id'));
    if (discussion.status === 'ended') {
      res.json({ id: discussion.id, status: discussion.status, summary: discussion.summary });
      return;
    }
    if (discussion.status !== 'live' && discussion.status !== 'paused') {
      throw ApiError.invalidState('讨论尚未开始');
    }

    // 等待引擎走完收尾流程（含生成自然语言总结）后再返回，
    // 这样前端拿到响应时 summary 一定已经就绪。
    await stopDiscussionRuntime(pathParam(req, 'id'));
    const updated = repo.getDiscussion(pathParam(req, 'id'));
    res.json({ id: updated?.id, status: updated?.status, summary: updated?.summary });
  }),
);

// ---------------------------------------------------------------- SSE

registerStreamRoute(router);

export { router };
