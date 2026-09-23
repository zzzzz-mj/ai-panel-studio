import { navigate } from '../hooks/useHashRoute';

interface Props {
  /** 后端是否运行在离线模拟引擎上（未配置 API Key） */
  mock: boolean | null;
  model: string | null;
  /** 演播厅页会把控制按钮交给页面自己渲染 */
  compact?: boolean;
}

export function AppHeader({ mock, model, compact = false }: Props) {
  return (
    <header className="app-header">
      <button type="button" className="app-header__brand" onClick={() => navigate('/')}>
        <span className="app-header__mark" aria-hidden="true" />
        <span className="app-header__names">
          <span className="app-header__title serif">AI Panel Studio</span>
          <span className="app-header__sub">AI 圆桌讨论 · 实时演播厅</span>
        </span>
      </button>

      {!compact && (
        <div className="app-header__meta">
          {mock === null ? (
            <span className="conn" data-state="closed">
              正在连接后端…
            </span>
          ) : (
            <span className="conn" data-state={mock ? 'closed' : 'open'}>
              <span className="dot" />
              {mock ? '离线模拟引擎（未配置 API Key）' : `已接入 ${model ?? '大模型'}`}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
