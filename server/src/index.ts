import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config';
import { getDb } from './db';
import { ApiError } from './errors';
import { router } from './routes';
import { getEngine } from './llm';

/**
 * 应用入口。
 *
 * 职责：装配中间件、挂载路由、统一错误处理、启动时初始化数据库。
 * 讨论引擎不在启动时预热 —— 只有用户点了「开始讨论」才会创建运行时。
 */

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin, credentials: false }));
  app.use(express.json({ limit: '128kb' }));

  app.use('/api', router);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  // 统一错误处理：ApiError 按自带状态码返回，其余一律 500 且不外泄堆栈
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    if (error instanceof Error && error.name === 'ZodError') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '请求参数不合法' } });
      return;
    }
    console.error('[server] 未处理异常:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务端异常' } });
  });

  return app;
}

function main(): void {
  // 启动即建库建表（幂等），避免首次运行时因为缺表而 500
  getDb();

  const app = createApp();
  const engine = getEngine();

  app.listen(config.port, () => {
    console.log(`[server] AI Panel Studio API 已启动: http://localhost:${config.port}`);
    console.log(`[server] 数据库: ${config.dbPath}`);
    console.log(
      `[server] 大模型: provider=${config.llm.provider} model=${engine.model} ${
        engine.mock ? '（未配置 API Key，已启用离线模拟引擎）' : '（真实模型）'
      }`,
    );
  });
}

// 仅在被直接执行时启动 HTTP 服务；被测试 import 时只暴露 createApp
if (require.main === module) {
  main();
}
