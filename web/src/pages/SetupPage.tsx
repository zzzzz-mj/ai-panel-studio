import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { Panelist, PanelistPatch } from '../api/types';
import { PanelistCard } from '../components/PanelistCard';
import { navigate } from '../hooks/useHashRoute';
import { PANELIST_PALETTE } from '../lib/palette';

interface Props {
  /** 从首页预置议题进入时带上的议题 id */
  presetId: string | null;
}

type Step = 'form' | 'generating' | 'panel';

const EXPERT_COUNTS = [2, 3, 4, 5, 6];

/**
 * 嘉宾生成与确认。
 *
 * 刻意拆成「填写议题 → 生成阵容 → 逐位确认」三步而不是一键直达：
 * 阵容是讨论质量的上游，用户必须有机会在开播前修正人设与身份色。
 */
export function SetupPage({ presetId }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [topic, setTopic] = useState('');
  const [background, setBackground] = useState('');
  const [expertCount, setExpertCount] = useState(4);

  const [discussionId, setDiscussionId] = useState<string | null>(null);
  const [panelists, setPanelists] = useState<Panelist[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 预置议题只填充表单，不自动生成阵容 —— 用户仍然要按下那一次按钮
  useEffect(() => {
    if (!presetId) return;
    let cancelled = false;
    void api
      .listPresets()
      .then((presets) => {
        const preset = presets.find((item) => item.id === presetId);
        if (!preset || cancelled) return;
        setTopic(preset.topic);
        setBackground(preset.background ?? '');
        setExpertCount(preset.expertCount);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [presetId]);

  const topicValid = topic.trim().length >= 2 && topic.trim().length <= 200;

  const generate = useCallback(
    async (existingId?: string): Promise<void> => {
      setError(null);
      setStep('generating');
      try {
        const id = existingId ?? (await api.createDiscussion({
          topic: topic.trim(),
          background: background.trim() === '' ? null : background.trim(),
          expertCount,
        })).id;
        setDiscussionId(id);

        const panel = await api.generatePanel(id);
        setPanelists(panel.panelists);
        setStep('panel');
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : '生成阵容失败，请重试');
        setStep(existingId ? 'panel' : 'form');
      }
    },
    [topic, background, expertCount],
  );

  const patchPanelist = useCallback(
    async (panelistId: string, patch: PanelistPatch): Promise<void> => {
      if (!discussionId) return;
      setSavingId(panelistId);
      try {
        const updated = await api.updatePanelist(discussionId, panelistId, patch);
        setPanelists((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setError(null);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : '保存失败，请重试');
      } finally {
        setSavingId(null);
      }
    },
    [discussionId],
  );

  const host = panelists.find((item) => item.role === 'host');
  const experts = panelists.filter((item) => item.role === 'expert');

  return (
    <div className="page setup">
      <div className="setup__scroll scroll-y">
        <div className="setup__inner">
          <header className="setup__head">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
              ← 返回首页
            </button>
            <p className="eyebrow">发起新讨论</p>
            <h1 className="setup__title serif">
              {step === 'panel' ? '确认嘉宾阵容' : '你要讨论什么？'}
            </h1>
            <p className="setup__sub muted">
              {step === 'panel'
                ? '阵容由大模型按议题动态生成。开播前你可以逐位微调姓名、Title、立场与身份色。'
                : '写下一个真正存在分歧的议题，并决定要请几位专家。'}
            </p>
          </header>

          {error && (
            <div className="alert">
              <span>{error}</span>
            </div>
          )}

          {step !== 'panel' && (
            <form
              className="setup__form"
              onSubmit={(event) => {
                event.preventDefault();
                if (topicValid && step === 'form') void generate();
              }}
            >
              <div className="field">
                <label className="field__label" htmlFor="topic">
                  讨论议题
                </label>
                <textarea
                  id="topic"
                  className="textarea"
                  rows={3}
                  maxLength={200}
                  placeholder="例如：远程办公是否会削弱团队的创新能力？"
                  value={topic}
                  disabled={step === 'generating'}
                  onChange={(event) => setTopic(event.target.value)}
                />
                <span className="field__hint">
                  {topic.trim().length} / 200 字 · 越具体的议题越容易形成真实交锋
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="background">
                  背景补充 <span className="faint">（可选）</span>
                </label>
                <textarea
                  id="background"
                  className="textarea"
                  rows={2}
                  maxLength={500}
                  placeholder="例如：面向 200 人规模的软件团队，已有两年混合办公经验"
                  value={background}
                  disabled={step === 'generating'}
                  onChange={(event) => setBackground(event.target.value)}
                />
              </div>

              <div className="field">
                <span className="field__label">参会专家人数</span>
                <div className="segmented" role="radiogroup" aria-label="参会专家人数">
                  {EXPERT_COUNTS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      role="radio"
                      aria-checked={expertCount === count}
                      className="segmented__item"
                      data-active={expertCount === count}
                      disabled={step === 'generating'}
                      onClick={() => setExpertCount(count)}
                    >
                      {count} 位
                    </button>
                  ))}
                </div>
                <span className="field__hint">不含主持人。人数越多，观点分布越广，也越容易出现分歧。</span>
              </div>

              <div className="setup__actions">
                <button type="submit" className="btn btn--primary" disabled={!topicValid || step === 'generating'}>
                  {step === 'generating' ? '正在生成主持人与专家阵容…' : '生成嘉宾阵容'}
                </button>
                {step === 'generating' && (
                  <span className="faint setup__pending">正在调用大模型，按议题匹配不同职业与立场的专家。</span>
                )}
              </div>
            </form>
          )}

          {step === 'panel' && (
            <div className="setup__panel">
              <div className="setup__topic-bar">
                <div>
                  <p className="eyebrow">议题</p>
                  <p className="setup__topic serif">{topic}</p>
                </div>
                <div className="setup__topic-actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={savingId !== null}
                    onClick={() => void generate(discussionId ?? undefined)}
                  >
                    重新生成阵容
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => {
                      setPanelists([]);
                      setStep('form');
                    }}
                  >
                    改议题
                  </button>
                </div>
              </div>

              {host && (
                <section className="setup__group">
                  <header className="section-head">
                    <span className="section-head__title">主持人</span>
                    <span className="mono faint">负责开场、追问、串联与总结</span>
                  </header>
                  <PanelistCard
                    panelist={host}
                    palette={PANELIST_PALETTE}
                    onPatch={patchPanelist}
                    saving={savingId === host.id}
                  />
                </section>
              )}

              <section className="setup__group">
                <header className="section-head">
                  <span className="section-head__title">专家阵容</span>
                  <span className="mono faint">{experts.length} 位</span>
                </header>
                <div className="setup__cards">
                  {experts.map((panelist, index) => (
                    <PanelistCard
                      key={panelist.id}
                      panelist={panelist}
                      palette={PANELIST_PALETTE}
                      onPatch={patchPanelist}
                      saving={savingId === panelist.id}
                    />
                  ))}
                </div>
              </section>

              <div className="setup__confirm">
                <p className="muted">
                  确认后进入演播厅。讨论开始后阵容将被锁定，不能再修改嘉宾人设。
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!discussionId || savingId !== null}
                  onClick={() => discussionId && navigate(`/d/${discussionId}`)}
                >
                  确认阵容，进入演播厅
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
