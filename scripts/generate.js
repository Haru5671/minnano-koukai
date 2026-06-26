#!/usr/bin/env node
// みんなの後悔 — 静的ハブページ生成スクリプト（依存ゼロ / Node v18+）
// index.html 内のデータ配列をそのまま読み取り、SEO/AIO 向けの静的ページを生成する。
// index.html の本文・フィード・Supabase ロジック・admin.html には一切触れない。
//
// 生成物:
//   /age/{10,20,30,40,50,60}/index.html   年代別の後悔ランキング・ハブ
//   /category/{slug}/index.html           カテゴリ別の後悔ハブ
//   /stats/index.html                     統計データ（Dataset）
//   /regret/{slug}/index.html             後悔クラスタ別の読み物記事
//   /sitemap.xml                          上記 + トップを列挙

const fs = require('fs');
const path = require('path');
const { ARTICLES } = require('./articles');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SITE = 'https://ko-kai.jp';
const TODAY = process.env.GEN_DATE || '2026-06-26';
const TODAY_JP = '2026年6月';

// ---------- データ抽出（文字列リテラルを尊重したブレース対応） ----------
function extractLiteral(src, name) {
  const at = src.indexOf('const ' + name + ' =');
  if (at === -1) throw new Error('データが見つかりません: ' + name);
  let i = src.indexOf('=', at) + 1;
  while (/\s/.test(src[i])) i++;
  const start = i;
  let depth = 0, inStr = false, q = '', esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  return (new Function('return (' + src.slice(start, i) + ')'))();
}

const CATEGORIES = extractLiteral(SRC, 'CATEGORIES');
const AI_REALIZATION_POOLS = extractLiteral(SRC, 'AI_REALIZATION_POOLS');
const initialPosts = extractLiteral(SRC, 'initialPosts');
const AI_ADVICE = extractLiteral(SRC, 'AI_ADVICE');

// ---------- メタ定義 ----------
const CAT_META = {
  '仕事・キャリア':   { slug: 'shigoto', short: '仕事',    ymyl: false, queries: ['仕事 後悔', '転職 後悔', 'キャリア 後悔'] },
  '恋愛・パートナー': { slug: 'renai',    short: '恋愛',    ymyl: false, queries: ['恋愛 後悔', '別れ 後悔', '復縁'] },
  '家族・親子':       { slug: 'kazoku',   short: '家族',    ymyl: false, queries: ['家族 後悔', '親 後悔', '親孝行'] },
  '学び・挑戦':       { slug: 'manabi',   short: '学び',    ymyl: false, queries: ['勉強 後悔', '挑戦しなかった 後悔'] },
  '友情・人間関係':   { slug: 'yujo',     short: '人間関係', ymyl: false, queries: ['人間関係 後悔', '友達 後悔'] },
  'お金・生活':       { slug: 'okane',    short: 'お金',    ymyl: true,  queries: ['お金 後悔', '浪費 後悔', '貯金 後悔'] },
  '健康・身体':       { slug: 'kenko',    short: '健康',    ymyl: true,  queries: ['健康 後悔', '運動 後悔'] },
  'その他':           { slug: 'sonota',   short: 'その他',  ymyl: false, queries: ['人生 後悔'] },
};
const AGE_SLUG = { '10代': '10', '20代': '20', '30代': '30', '40代': '40', '50代': '50', '60代以上': '60' };
const AGE_LABEL = { '10代': '10代', '20代': '20代', '30代': '30代', '40代': '40代', '50代': '50代', '60代以上': '60代以上' };

const TOTAL = initialPosts.length;

// ---------- ユーティリティ ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function countBy(arr, key) {
  const m = {};
  for (const x of arr) m[x[key]] = (m[x[key]] || 0) + 1;
  return m;
}
function pct(n, d) { return Math.round((n / d) * 1000) / 10; }

// ---------- 共通テンプレート ----------
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0806;--bg-2:#16110b;--white:#1c1814;--surface-2:#25201a;--border:#3a322a;--border-2:#4a4036;--text:#f0e6d2;--text-2:#bfb4a0;--text-3:#8a7e6e;--primary:#d4a548;--primary-dk:#c79a40;--soft:rgba(212,165,72,0.12);--radius:12px}
html{scroll-behavior:smooth}
body{font-family:'Yu Mincho','Hiragino Mincho ProN','Noto Serif JP',Georgia,'Hiragino Sans','Yu Gothic',serif;background:var(--bg);color:var(--text);line-height:1.9;-webkit-font-smoothing:antialiased;font-size:16.5px}
a{color:var(--primary)}
header{position:sticky;top:0;z-index:50;background:rgba(12,9,6,.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.hd{max-width:860px;margin:0 auto;padding:0 20px;height:58px;display:flex;align-items:center;gap:20px}
.logo{font-weight:900;font-size:17px;color:var(--primary-dk);text-decoration:none;letter-spacing:-.5px;flex-shrink:0}
.hd nav{display:flex;gap:4px;flex-wrap:wrap;overflow:hidden;flex:1}
.hd nav a{font-size:12.5px;font-weight:600;color:var(--text-3);text-decoration:none;padding:5px 11px;border-radius:9999px;white-space:nowrap}
.hd nav a:hover{background:var(--soft);color:var(--primary-dk)}
.hd .cta{margin-left:auto;flex-shrink:0;background:var(--primary);color:#1c1814;font-size:12.5px;font-weight:700;padding:7px 16px;border-radius:9999px;text-decoration:none}
main{max-width:760px;margin:0 auto;padding:0 20px 64px}
.crumb{font-size:12px;color:var(--text-3);padding:18px 0 6px}
.crumb a{color:var(--text-3);text-decoration:none}
.crumb a:hover{text-decoration:underline}
h1{font-size:31px;line-height:1.45;font-weight:900;letter-spacing:-.5px;margin:14px 0 18px}
.lead{font-size:16px;color:var(--text-2);background:var(--white);border:1px solid var(--border);border-left:4px solid var(--primary);border-radius:12px;padding:18px 22px;margin-bottom:34px}
.updated{font-size:12px;color:var(--text-3);margin-bottom:26px}
h2{font-size:22px;font-weight:800;line-height:1.5;margin:42px 0 16px;padding-bottom:10px;border-bottom:2px solid var(--soft)}
h3{font-size:17px;font-weight:700;margin:26px 0 10px;color:var(--primary-dk)}
p{margin:0 0 14px}
ul,ol{margin:0 0 16px;padding-left:1.4em}
li{margin:0 0 9px}
blockquote{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin:0 0 14px;color:var(--text-2)}
blockquote cite{display:block;margin-top:8px;font-size:12px;color:var(--text-3);font-style:normal}
.rank{list-style:none;padding:0;counter-reset:r}
.rank li{counter-increment:r;background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 18px 16px 56px;position:relative;margin-bottom:12px}
.rank li::before{content:counter(r);position:absolute;left:16px;top:16px;width:28px;height:28px;background:var(--primary);color:#1c1814;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.rank .rt{font-weight:700;font-size:16px;margin-bottom:4px}
.rank .rp{color:var(--primary-dk);font-weight:800;font-size:13px;margin-left:8px}
.rank .ri{font-size:13.5px;color:var(--text-3);line-height:1.7;margin-top:6px}
table{width:100%;border-collapse:collapse;margin:0 0 18px;font-size:14px;background:var(--white);border:1px solid var(--border);border-radius:12px;overflow:hidden}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--border)}
th{background:var(--soft);font-weight:700;color:var(--primary-dk)}
td.n{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:none}
.steps{list-style:none;padding:0}
.steps li{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:14px 18px;margin-bottom:10px}
.steps b{display:block;font-size:14.5px;margin-bottom:4px}
.steps span{font-size:13.5px;color:var(--text-3)}
.steps a{font-size:13px;font-weight:700}
.cta-box{background:linear-gradient(135deg,#1c1814,#251a0e);border:1px solid var(--primary-dk);color:var(--text);border-radius:var(--radius);padding:28px 26px;margin:40px 0;text-align:center}
.cta-box p{color:var(--text-2);margin-bottom:16px}
.cta-box a{display:inline-block;background:var(--primary);color:#1c1814;font-weight:800;padding:12px 28px;border-radius:9999px;text-decoration:none}
.note{background:rgba(212,165,72,0.07);border:1px solid rgba(212,165,72,0.3);border-radius:12px;padding:14px 18px;font-size:13px;color:#e8a87c;margin:20px 0;line-height:1.75}
.crisis{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 18px;font-size:13px;margin:20px 0;line-height:1.8}
.crisis b{color:var(--primary-dk)}
.links{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}
.links a{font-size:13px;font-weight:600;background:var(--white);border:1px solid var(--border);border-radius:9999px;padding:8px 16px;text-decoration:none;color:var(--text-2)}
.links a:hover{border-color:var(--primary);color:var(--primary-dk)}
footer{border-top:1px solid var(--border);background:var(--white);margin-top:48px}
.ft{max-width:760px;margin:0 auto;padding:34px 20px 56px;font-size:12.5px;color:var(--text-3);line-height:1.9}
.ft h4{font-size:13px;color:var(--text-2);margin-bottom:8px}
.ft a{color:var(--text-3);text-decoration:none;margin-right:14px}
.ft a:hover{color:var(--primary-dk)}
.ft .op{margin:14px 0;padding:14px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
@media(max-width:560px){h1{font-size:25px}h2{font-size:20px}.hd nav{display:none}}
`;

const NAV = [
  ['/', 'トップ'],
  ['/stats/', '統計データ'],
  ['/age/20/', '20代の後悔'],
  ['/age/30/', '30代の後悔'],
  ['/category/shigoto/', '仕事'],
  ['/category/okane/', 'お金'],
  ['/regret/forget/', '後悔を忘れる'],
  ['/regret/psychology/', '後悔の心理学'],
];

function header(activeCta = '/') {
  return `<header><div class="hd"><a class="logo" href="/">みんなの後悔</a><nav>` +
    NAV.map(([h, t]) => `<a href="${h}">${t}</a>`).join('') +
    `</nav><a class="cta" href="/#post">後悔を書く</a></div></header>`;
}

function crumb(items) {
  // items: [[name, href|null], ...]
  return `<nav class="crumb" aria-label="パンくず">` +
    items.map((it, i) => it[1] ? `<a href="${it[1]}">${esc(it[0])}</a>` : `<span>${esc(it[0])}</span>`).join(' › ') +
    `</nav>`;
}

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it[0],
      ...(it[1] ? { item: SITE + it[1] } : {}),
    })),
  };
}

const CRISIS_HTML = `<div class="crisis"><b>つらい気持ちが続くときは、ひとりで抱えないでください。</b><br>
・よりそいホットライン：<b>0120-279-338</b>（24時間・通話無料）<br>
・いのちの電話（ナビダイヤル）：<b>0570-783-556</b>（午前10時〜午後10時）<br>
日常生活に支障が出ている場合は、お近くの心療内科・精神科の受診もご検討ください。</div>`;

function footer() {
  return `<footer><div class="ft">
<h4>みんなの後悔</h4>
<p>後悔を匿名で共有し、年代別の統計とAIによる助言を提供するコミュニティです。掲載するAIアドバイス・統計データは参考情報であり、医療・法律・金融・投資等の専門的助言に代わるものではありません。重要な判断は各分野の専門家にご相談ください。</p>
<div class="op">運営：株式会社FEworks ｜ <a href="/about/">運営者情報・このサイトについて</a></div>
<div><a href="/">トップ</a><a href="/stats/">統計データ</a><a href="/regret/anonymous/">匿名で書く</a><a href="/about/">運営者情報</a><a href="/#terms">利用規約</a><a href="/#privacy">プライバシーポリシー</a></div>
<p style="margin-top:14px">© 2026 みんなの後悔 — 登録不要・完全無料</p>
</div></footer>`;
}

function page({ pathname, title, description, h1, lead, bodyHtml, jsonld, lastmod }) {
  const url = SITE + pathname;
  const ld = (Array.isArray(jsonld) ? jsonld : [jsonld]).filter(Boolean)
    .map(o => `<script type="application/ld+json">\n${JSON.stringify(o, null, 0)}\n</script>`).join('\n');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="みんなの後悔">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="ja_JP">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#06c755">
${ld}
<style>${CSS}</style>
</head>
<body>
${header(pathname)}
<main>
${bodyHtml}
</main>
${footer()}
</body>
</html>`;
}

function write(pathname, html) {
  const dir = path.join(ROOT, pathname.replace(/^\//, ''));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return pathname;
}

// ---------- 部品レンダラ ----------
function postQuote(p) {
  const cat = p.category || '';
  return `<blockquote>${esc(p.text)}<cite>— ${esc(p.age || '匿名')}・${esc(p.gender && p.gender !== '未回答' ? p.gender : '匿名')}／${esc(cat)}</cite></blockquote>`;
}
function stepsList(steps) {
  return `<ul class="steps">` + steps.map(s => {
    const link = s.link ? ` <a href="${esc(s.link)}" target="_blank" rel="noopener nofollow">${esc(s.linkText || s.link)} ↗</a>` : '';
    return `<li><b>${esc(s.title)}</b><span>${esc(s.desc)}${link}</span></li>`;
  }).join('') + `</ul>`;
}
function discussionLd(posts, url) {
  return posts.slice(0, 12).map(p => ({
    '@context': 'https://schema.org', '@type': 'DiscussionForumPosting',
    headline: (p.text || '').slice(0, 60), articleBody: p.text,
    datePublished: TODAY, url,
    author: { '@type': 'Person', name: '匿名' },
    about: p.category,
  }));
}
function faqLd(qa) {
  return {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: qa.map(([q, a]) => ({
      '@type': 'Question', name: q,
      acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '').slice(0, 1200) },
    })),
  };
}

const written = [];

// ---------- 年代別ハブ ----------
for (const age of Object.keys(AI_ADVICE)) {
  const slug = AGE_SLUG[age];
  const pathname = `/age/${slug}/`;
  const adv = AI_ADVICE[age];
  const posts = initialPosts.filter(p => p.age === age);
  const n = posts.length;
  const ranked = (adv.items || []).slice().sort((a, b) => (b.pct || 0) - (a.pct || 0));

  const title = `${age}の後悔ランキング｜先輩世代が後悔していること【${TOTAL}件集計・2026年】`;
  const description = `${adv.from}を年代別に集計。${age}の今だからできる具体策と、実際に寄せられた${age}のリアルな後悔の声を紹介します。登録不要・匿名でAIが助言。`;
  const h1 = `${age}が知っておきたい後悔ランキング｜${adv.from}`;

  const qa = [];
  let body = `<p class="lead">${esc(adv.message)}</p><p class="updated">最終更新：${TODAY_JP}（本サイトの匿名投稿${TOTAL}件をもとに集計）</p>`;

  const q1 = `${age}の人が後悔しやすいことは？`;
  let a1 = `<p>本サイトの匿名投稿と${adv.from.replace(/が最も後悔していること$/, '')}世代の声を集計すると、${age}の段階で意識しておきたい後悔は次の通りです。割合は「その後悔を挙げた人の割合」を示します。</p><ol class="rank">` +
    ranked.map(it => `<li><span class="rt">${esc(it.regret)}<span class="rp">${it.pct}%</span></span><div class="ri">${esc(it.insight)}</div></li>`).join('') + `</ol>`;
  body += `<h2>${esc(q1)}</h2>${a1}`;
  qa.push([q1, a1]);

  if (n > 0) {
    const byCatAge = countBy(posts, 'category');
    const ord = Object.keys(byCatAge).sort((x, y) => byCatAge[y] - byCatAge[x]);
    const topCatAge = ord[0];
    const q15 = `${age}の後悔で多いテーマは？`;
    let a15 = `<p>みんなの後悔に寄せられた${age}の投稿${n}件をテーマ別に分類すると、最も多い後悔は「${esc(topCatAge)}」で、${age}全体の${pct(byCatAge[topCatAge], n)}%を占めました。${age}が実際に何を後悔しているかの一次データです。</p>
<table><thead><tr><th>後悔のテーマ</th><th>件数</th><th>割合</th></tr></thead><tbody>` +
      ord.map(c => `<tr><td><a href="/category/${CAT_META[c].slug}/">${esc(c)}</a></td><td class="n">${byCatAge[c]}</td><td class="n">${pct(byCatAge[c], n)}%</td></tr>`).join('') +
      `</tbody></table>`;
    body += `<h2>${esc(q15)}</h2>${a15}`;
    qa.push([q15, `${age}の後悔で最も多いテーマは「${topCatAge}」で${pct(byCatAge[topCatAge], n)}%。`]);
  }

  const q2 = `${age}が今からできることは？`;
  let a2 = ranked.map(it => `<h3>${esc(it.regret)}への対策</h3><p>${esc(it.root)}</p>${stepsList(it.steps || [])}`).join('');
  body += `<h2>${esc(q2)}</h2>${a2}`;
  qa.push([q2, ranked.map(it => it.regret + '：' + it.root).join(' ')]);

  if (n > 0) {
    const q3 = `${age}のリアルな後悔の声（実際の投稿）`;
    let a3 = `<p>みんなの後悔に寄せられた、${age}の方々の実際の後悔です（匿名・抜粋）。</p>` +
      posts.slice(0, 24).map(postQuote).join('');
    body += `<h2>${esc(q3)}</h2>${a3}`;
  }

  body += `<div class="cta-box"><p>あなたの${age}の後悔も、聞かせてください。<br>匿名で書き出すと、AIが「今からできること」を提案します。</p><a href="/regret/anonymous/">匿名で後悔を書く</a></div>`;

  const siblings = Object.keys(AGE_SLUG).filter(a => a !== age)
    .map(a => `<a href="/age/${AGE_SLUG[a]}/">${a}の後悔</a>`).join('');
  body += `<h2>ほかの年代の後悔も見る</h2><div class="links">${siblings}<a href="/stats/">年代別の統計データ</a></div>`;

  const crumbs = [['みんなの後悔', '/'], ['年代別の後悔', null], [`${age}の後悔`, null]];
  const ld = [
    breadcrumbLd(crumbs),
    {
      '@context': 'https://schema.org', '@type': 'CollectionPage',
      name: h1, url: SITE + pathname, inLanguage: 'ja', description,
      isPartOf: { '@type': 'WebSite', name: 'みんなの後悔', url: SITE },
    },
    {
      '@context': 'https://schema.org', '@type': 'Dataset',
      name: `${age}の後悔集計データ`, description: `みんなの後悔に寄せられた${age}の匿名投稿${n}件の集計`,
      creator: { '@type': 'Organization', name: '株式会社FEworks' },
      temporalCoverage: '2026', inLanguage: 'ja',
      variableMeasured: ['後悔のカテゴリ', '件数', '割合'],
    },
    faqLd(qa),
    ...discussionLd(posts, SITE + pathname),
  ];
  written.push(write(pathname, page({ pathname, title, description, h1, bodyHtml: `<h1>${esc(h1)}</h1>` + body, jsonld: ld, lastmod: TODAY })));
}

// ---------- カテゴリ別ハブ ----------
const catCount = countBy(initialPosts, 'category');
for (const cat of Object.keys(CAT_META)) {
  const meta = CAT_META[cat];
  const pathname = `/category/${meta.slug}/`;
  const posts = initialPosts.filter(p => p.category === cat);
  const n = posts.length;
  const pools = AI_REALIZATION_POOLS[cat] || [];

  const title = `${cat}の後悔｜みんなのリアルな声と、今からできること【2026年】`;
  const description = `${meta.short}に関する後悔の実例を${n}件以上掲載。${meta.queries.join('・')}など、よくある後悔と、AIが提案する具体的な対策をまとめました。匿名・登録不要。`;
  const h1 = `${cat}で後悔している人へ｜みんなの声と今できること`;

  const qa = [];
  let body = `<p class="lead">「${meta.short}のことで、あのときこうしておけば」——${cat}は、年代を問わず多くの人が後悔を抱えるテーマです。本ページでは、寄せられた${n}件の${meta.short}の後悔と、AIによる「今からでも遅くない」具体策を紹介します。</p><p class="updated">最終更新：${TODAY_JP}（${cat}の投稿${n}件をもとに構成）</p>`;

  if (meta.ymyl) {
    body += `<div class="note">本ページの内容は一般的な情報提供であり、個別の医療・投資・金融上の助言ではありません。具体的な判断は、医師・専門家にご相談ください。</div>`;
  }

  const q1 = `${cat}でよくある後悔とは？`;
  let a1 = `<p>${cat}の後悔として代表的なのは、次のようなパターンです。それぞれにAIが「今からできること」を提案します。</p>` +
    pools.map(v => `<h3>${esc(v.title)}</h3><p>${esc(v.why)}</p>${stepsList(v.steps || [])}`).join('');
  body += `<h2>${esc(q1)}</h2>${a1}`;
  qa.push([q1, pools.map(v => v.title + '：' + v.why).join(' ')]);

  if (n > 0) {
    const q2 = `みんなの${meta.short}の後悔（実際の声）`;
    let a2 = `<p>みんなの後悔に寄せられた、${cat}に関する実際の後悔です（匿名・抜粋）。</p>` +
      posts.slice(0, 30).map(postQuote).join('');
    body += `<h2>${esc(q2)}</h2>${a2}`;
  }

  body += `<div class="cta-box"><p>${meta.short}の後悔を、匿名で吐き出してみませんか。<br>AIがあなたの状況に合わせて次の一歩を提案します。</p><a href="/regret/anonymous/">匿名で後悔を書く</a></div>`;

  const siblings = Object.keys(CAT_META).filter(c => c !== cat)
    .map(c => `<a href="/category/${CAT_META[c].slug}/">${CAT_META[c].short}の後悔</a>`).join('');
  body += `<h2>ほかのカテゴリの後悔</h2><div class="links">${siblings}<a href="/stats/">統計データ</a></div>`;

  const crumbs = [['みんなの後悔', '/'], ['カテゴリ別の後悔', null], [`${cat}`, null]];
  const ld = [
    breadcrumbLd(crumbs),
    {
      '@context': 'https://schema.org', '@type': 'CollectionPage',
      name: h1, url: SITE + pathname, inLanguage: 'ja', description,
      isPartOf: { '@type': 'WebSite', name: 'みんなの後悔', url: SITE },
    },
    faqLd(qa),
    ...discussionLd(posts, SITE + pathname),
  ];
  written.push(write(pathname, page({ pathname, title, description, h1, bodyHtml: `<h1>${esc(h1)}</h1>` + body, jsonld: ld, lastmod: TODAY })));
}

// ---------- 統計ページ ----------
{
  const pathname = '/stats/';
  const byAge = countBy(initialPosts, 'age');
  const byCat = catCount;
  const ageOrder = ['10代', '20代', '30代', '40代', '50代', '60代以上'];
  const catOrder = Object.keys(CAT_META).sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));
  const topCat = catOrder[0];

  const title = `後悔の統計データ2026｜${TOTAL}件の匿名投稿を年代別・カテゴリ別に集計`;
  const description = `みんなの後悔に寄せられた${TOTAL}件の匿名の後悔を、年代別・カテゴリ別に集計。最も多い後悔のカテゴリは「${CAT_META[topCat].short}」で全体の${pct(byCat[topCat], TOTAL)}%。データは自由に引用できます。`;
  const h1 = `後悔の統計データ｜${TOTAL}件のリアルな後悔を集計【2026年版】`;

  const catRows = catOrder.map(c => `<tr><td>${esc(c)}</td><td class="n">${byCat[c] || 0}</td><td class="n">${pct(byCat[c] || 0, TOTAL)}%</td></tr>`).join('');
  const ageRows = ageOrder.map(a => `<tr><td>${esc(a)}</td><td class="n">${byAge[a] || 0}</td><td class="n">${pct(byAge[a] || 0, TOTAL)}%</td></tr>`).join('');

  const qa = [];
  let body = `<h1>${esc(h1)}</h1>`;
  body += `<p class="lead">本サイトの匿名投稿${TOTAL}件を分析した結果、最も多い後悔のカテゴリは「${esc(topCat)}」で、全体の${pct(byCat[topCat], TOTAL)}%を占めました。以下のデータは出典を明記のうえ、自由に引用していただけます。</p><p class="updated">最終更新：${TODAY_JP}／集計対象：${TOTAL}件</p>`;

  const q1 = `最も多い後悔のカテゴリは何か？`;
  let a1 = `<p>本サイトの匿名投稿${TOTAL}件の分析によると、後悔のカテゴリで最も多いのは「${esc(topCat)}」で全体の${pct(byCat[topCat], TOTAL)}%。次いで「${esc(catOrder[1])}」（${pct(byCat[catOrder[1]], TOTAL)}%）、「${esc(catOrder[2])}」（${pct(byCat[catOrder[2]], TOTAL)}%）と続きます。</p>
<table><thead><tr><th>後悔のカテゴリ</th><th>件数</th><th>割合</th></tr></thead><tbody>${catRows}</tbody></table>`;
  body += `<h2>${esc(q1)}</h2>${a1}`;
  qa.push([q1, `本サイトの匿名投稿${TOTAL}件のうち、最も多い後悔は「${topCat}」で${pct(byCat[topCat], TOTAL)}%。`]);

  const q2 = `年代別では、後悔はどう分布しているか？`;
  let a2 = `<p>投稿者の年代別の分布は次の通りです。</p><table><thead><tr><th>年代</th><th>件数</th><th>割合</th></tr></thead><tbody>${ageRows}</tbody></table><p>年代別の詳しい後悔ランキングは、各年代ページ（<a href="/age/20/">20代</a>／<a href="/age/30/">30代</a>／<a href="/age/40/">40代</a>／<a href="/age/50/">50代</a>）でご覧いただけます。</p>`;
  body += `<h2>${esc(q2)}</h2>${a2}`;
  qa.push([q2, `年代別では${ageOrder.map(a => a + 'が' + (byAge[a] || 0) + '件').join('、')}。`]);

  body += `<h2>このデータについて（出典・引用）</h2><p>出典：「みんなの後悔」（${SITE}）。${TOTAL}件の匿名投稿をカテゴリ・年代別に集計したもので、2026年6月時点のデータです。引用される際は出典の明記をお願いします。投稿は随時更新されるため、最新の傾向は本ページで更新します。</p>`;

  body += `<div class="cta-box"><p>このデータは、あなたの一件から作られています。<br>あなたの後悔も、匿名で加えてみませんか。</p><a href="/regret/anonymous/">匿名で後悔を書く</a></div>`;

  const crumbs = [['みんなの後悔', '/'], ['統計データ', null]];
  const ld = [
    breadcrumbLd(crumbs),
    {
      '@context': 'https://schema.org', '@type': 'Dataset',
      name: '後悔の統計データ（みんなの後悔）',
      description: `${TOTAL}件の匿名の後悔をカテゴリ別・年代別に集計したデータセット`,
      url: SITE + pathname, inLanguage: 'ja', temporalCoverage: '2026',
      creator: { '@type': 'Organization', name: '株式会社FEworks', url: SITE },
      variableMeasured: ['後悔のカテゴリ', '投稿者の年代', '件数', '割合'],
      license: 'https://ko-kai.jp/about/',
    },
    {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: h1, description, inLanguage: 'ja',
      datePublished: '2026-04-17', dateModified: TODAY,
      author: { '@type': 'Organization', name: 'みんなの後悔' },
      publisher: { '@type': 'Organization', name: '株式会社FEworks' },
      mainEntityOfPage: SITE + pathname,
    },
    faqLd(qa),
  ];
  written.push(write(pathname, page({ pathname, title, description, h1, bodyHtml: body, jsonld: ld, lastmod: TODAY })));
}

// ---------- 後悔クラスタ別の記事 ----------
for (const art of ARTICLES) {
  const pathname = `/regret/${art.slug}/`;
  const qa = art.sections.map(s => [s.q, s.a]);
  let body = `<h1>${esc(art.h1)}</h1><p class="lead">${esc(art.lead)}</p><p class="updated">最終更新：${TODAY_JP}</p>`;
  if (art.sensitive) body += CRISIS_HTML;
  for (const s of art.sections) body += `<h2>${esc(s.q)}</h2>${s.a}`;
  if (art.sensitive) {
    body += `<div class="note">このページは医療・心理の専門的助言に代わるものではありません。症状が続く・強い場合は、医療機関や専門の相談窓口をご利用ください。</div>`;
  }
  if (art.sources && art.sources.length) {
    body += `<h2>参考・出典</h2><ul>` + art.sources.map(s => s.url ? `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a></li>` : `<li>${esc(s.name)}</li>`).join('') + `</ul>`;
  }
  body += `<div class="cta-box"><p>あなたの後悔も、匿名で書き出せます。<br>登録不要・完全無料。AIが次の一歩を一緒に考えます。</p><a href="/regret/anonymous/">匿名で後悔を書く</a></div>`;
  if (art.related && art.related.length) {
    const rel = art.related.map(rs => {
      const a = ARTICLES.find(x => x.slug === rs);
      return a ? `<a href="/regret/${a.slug}/">${esc(a.h1.split('｜')[0])}</a>` : '';
    }).join('');
    body += `<h2>関連する記事</h2><div class="links">${rel}<a href="/stats/">後悔の統計データ</a></div>`;
  }

  const crumbs = [['みんなの後悔', '/'], ['後悔と向き合う', null], [art.h1.split('｜')[0], null]];
  const ld = [
    breadcrumbLd(crumbs),
    {
      '@context': 'https://schema.org', '@type': art.schemaType || 'Article',
      headline: art.h1, description: art.description, inLanguage: 'ja',
      datePublished: '2026-04-17', dateModified: TODAY,
      author: { '@type': 'Organization', name: 'みんなの後悔' },
      publisher: { '@type': 'Organization', name: '株式会社FEworks', url: SITE },
      mainEntityOfPage: SITE + pathname,
    },
    faqLd(qa),
  ];
  written.push(write(pathname, page({ pathname, title: art.title, description: art.description, h1: art.h1, bodyHtml: body, jsonld: ld, lastmod: TODAY })));
}

// ---------- 運営者情報 / このサイトについて ----------
{
  const pathname = '/about/';
  const title = 'このサイトについて・運営者情報｜みんなの後悔';
  const description = 'みんなの後悔の運営者、データの集計方法、AIアドバイスの位置づけ、免責事項についてご説明します。運営：株式会社FEworks。';
  const h1 = 'このサイトについて・運営者情報';
  const byCat = catCount;
  const topCat = Object.keys(CAT_META).sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0))[0];
  let body = `<h1>${esc(h1)}</h1>
<p class="lead">みんなの後悔は、後悔を匿名で共有し、年代別の統計とAIによる助言を通じて「後悔しない人生」を支援するコミュニティです。本ページでは、運営者・データの扱い・免責についてご説明します。</p>
<h2>みんなの後悔とは？</h2>
<p>「あのとき、ああしておけば」という後悔は、誰もが抱えるものです。みんなの後悔は、その後悔を登録不要・完全匿名で書き出せる場所です。集まった後悔は年代・カテゴリ別に集計され、上の世代の後悔を下の世代が先回りして知ることで、後悔しない選択を支援します。さらにAIが、一つひとつの後悔に「今からでも遅くない具体的な一歩」を提案します。</p>
<h2>データはどのように集計していますか？</h2>
<p>本サイトの統計は、利用者から匿名で投稿された後悔を、カテゴリ（8分類）と年代（10代〜60代以上）ごとに集計したものです。2026年6月時点で${TOTAL}件を集計対象とし、最も多い後悔のカテゴリは「${esc(topCat)}」です。氏名・連絡先など個人を特定する情報は一切取得していません。最新の集計は<a href="/stats/">統計データ</a>で公開しています。</p>
<h2>AIアドバイスについて</h2>
<p>掲載するAIアドバイス・統計データは、一般的な情報提供を目的とした参考情報です。AIによる助言であり、医療・心理・法律・金融・投資等の専門家による個別の助言に代わるものではありません。重要な判断は、必ず各分野の専門家にご相談ください。</p>
<h2>運営者</h2>
<p>本サイトは<strong>株式会社FEworks</strong>が運営しています。利用規約・プライバシーポリシーは<a href="/">トップページ</a>のフッターからご確認いただけます。投稿の削除等のご要望がある場合の窓口は、別途ご案内します。</p>
${CRISIS_HTML}
<div class="links"><a href="/stats/">統計データ</a><a href="/regret/anonymous/">匿名で後悔を書く</a><a href="/regret/psychology/">後悔の心理学</a></div>`;
  const crumbs = [['みんなの後悔', '/'], ['このサイトについて', null]];
  const ld = [
    breadcrumbLd(crumbs),
    {
      '@context': 'https://schema.org', '@type': 'Organization',
      name: '株式会社FEworks', alternateName: ['みんなの後悔', 'ko-kai', 'FEworks'],
      url: SITE, logo: SITE + '/apple-touch-icon.png', inLanguage: 'ja',
      description: '後悔を匿名で共有し、年代別の統計とAIによる助言を提供するコミュニティ「みんなの後悔」の運営者。',
    },
    {
      '@context': 'https://schema.org', '@type': 'AboutPage',
      name: h1, url: SITE + pathname, inLanguage: 'ja', description,
    },
  ];
  written.push(write(pathname, page({ pathname, title, description, h1, bodyHtml: body, jsonld: ld, lastmod: TODAY })));
}

// ---------- sitemap.xml ----------
const urls = ['/'].concat(written.slice().sort());
const sm = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE}${u}</loc><lastmod>${TODAY}</lastmod><changefreq>${u === '/' ? 'daily' : 'weekly'}</changefreq><priority>${u === '/' ? '1.0' : '0.8'}</priority></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sm);

console.log(`生成完了: ${written.length} ページ + sitemap.xml`);
written.forEach(u => console.log('  ' + u));
