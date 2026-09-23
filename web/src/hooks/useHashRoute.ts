import { useEffect, useState } from 'react';

/**
 * 极简 hash 路由。
 *
 * 三页应用不值得引入路由库：hash 天然支持刷新保留、前进后退，
 * 且不依赖服务端 history fallback。
 */

export type Route =
  | { name: 'home' }
  | { name: 'setup'; presetId: string | null }
  | { name: 'studio'; discussionId: string };

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path = '/', query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  const segments = path.split('/').filter(Boolean);

  if (segments[0] === 'new') return { name: 'setup', presetId: params.get('preset') };
  if (segments[0] === 'd' && segments[1]) return { name: 'studio', discussionId: segments[1] };
  return { name: 'home' };
}

export function navigate(to: string): void {
  const next = to.startsWith('#') ? to : `#${to}`;
  if (window.location.hash === next) return;
  window.location.hash = next;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
