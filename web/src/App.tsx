import { useEffect, useState } from 'react';
import { api } from './api/client';
import type { HealthInfo } from './api/types';
import { AppHeader } from './components/AppHeader';
import { useHashRoute } from './hooks/useHashRoute';
import { HomePage } from './pages/HomePage';
import { SetupPage } from './pages/SetupPage';
import { StudioPage } from './pages/StudioPage';

/**
 * 应用外壳：一个高度锁定的 flex 列（页头 + 页面主体）。
 *
 * 页面主体自己不滚动，由每一页把剩余高度分给内部各区域 ——
 * 这样「整页不滚动、各区域独立滚动」就是结构性的，而不是靠 overflow 打补丁。
 */
export function App() {
  const route = useHashRoute();
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void api
        .health()
        .then((info) => {
          if (!cancelled) setHealth(info);
        })
        .catch(() => undefined);
    };
    load();
    // 后端可能比前端晚起来，低频重试直到拿到一次健康信息
    const timer = window.setInterval(() => {
      if (health) {
        window.clearInterval(timer);
        return;
      }
      load();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [health]);

  return (
    <div className="app">
      <AppHeader mock={health ? health.llm.mock : null} model={health?.llm.model ?? null} />

      <main className="app__main">
        {route.name === 'home' && <HomePage />}
        {route.name === 'setup' && <SetupPage presetId={route.presetId} />}
        {route.name === 'studio' && <StudioPage discussionId={route.discussionId} />}
      </main>
    </div>
  );
}
