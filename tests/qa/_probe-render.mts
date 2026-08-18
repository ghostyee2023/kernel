import { renderToStaticMarkup } from 'react-dom/server';
import RankPage from '@/app/rank/page';

try {
  const el = await RankPage();
  const html = renderToStaticMarkup(el);
  console.log('RENDER_OK length=', html.length);
  console.log('has podium:', html.includes('podium'));
  console.log('has medal--gold:', html.includes('medal--gold'));
  console.log('has 排行榜:', html.includes('排行榜'));
  console.log('has href /w/:', html.includes('/w/Aur9raFx') || html.includes('/w/NebuLa42'));
  console.log('head fragment:', html.slice(0, 300).replace(/\n/g, ' '));
} catch (e) {
  console.error('RENDER_FAIL:', (e as Error).message);
}
