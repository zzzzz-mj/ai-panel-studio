import { ApiError } from '../errors';
import { getEngine } from '../llm';
import { type PanelistInsert, type Repo, getRepo } from '../db/repo';
import type { Panelist } from '../domain/types';
import { pickColor } from '../util/palette';

/**
 * 阵容生成。
 *
 * 职责边界：调用模型拿到「人名 + 头衔 + 立场」，然后由服务端补齐
 * 模型不该决定的东西 —— 颜色、席位顺序、主持人色。颜色由服务端分配
 * 才能保证同一讨论内唯一且可复现。
 */

/** 主持人使用品牌主色（舞台琥珀金），与专家的身份色区分开。 */
export const HOST_COLOR = '#E7B24A';

export async function generatePanel(discussionId: string, repo: Repo = getRepo()): Promise<Panelist[]> {
  const discussion = repo.getDiscussion(discussionId);
  if (!discussion) throw ApiError.notFound('讨论不存在');

  if (discussion.status !== 'draft' && discussion.status !== 'ready') {
    throw ApiError.invalidState('讨论已开始或已结束，无法重新生成阵容');
  }

  const draft = await getEngine().generatePanel({
    topic: discussion.topic,
    background: discussion.background,
    expertCount: discussion.expertCount,
  });

  const inserts: PanelistInsert[] = [
    {
      role: 'host',
      name: draft.host.name,
      title: draft.host.title,
      org: draft.host.org ?? null,
      stance: draft.host.stance,
      bio: draft.host.bio,
      color: HOST_COLOR,
      orderIndex: 0,
    },
    ...draft.experts.map((expert, index) => ({
      role: 'expert' as const,
      name: expert.name,
      title: expert.title,
      org: expert.org ?? null,
      stance: expert.stance,
      bio: expert.bio,
      color: pickColor(index),
      orderIndex: index + 1,
    })),
  ];

  const panelists = repo.replacePanelists(discussionId, inserts);
  repo.updateDiscussion(discussionId, { status: 'ready' });
  return panelists;
}
