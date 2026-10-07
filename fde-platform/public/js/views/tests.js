import { h, card, table, note, callout, pill, clear, actionBtn, toast, fmtTs, tabs } from '../ui.js';
import * as api from '../api.js';

export async function render({ S }) {
  const cat = await api.get('/tests/catalog');
  const holder = h('div'); const out = h('div'); const GROUPS = [...new Set(cat.map((c) => c.group))];
  const canRun = S.can('fde', 'consultant', 'admin');
  let last = null;
  const resultCell = (x) => h('div', null,
    h('span', { class: x.pass ? 'pass' : 'fail' }, x.pass ? '✓ 통과' : '✗ 실패'),
    h('ul', { class: 'tiny', style: 'margin:4px 0 0;padding-left:14px' },
      x.checks.map((k) => h('li', { class: k.pass ? '' : 'fail' }, k.msg)),
      x.error ? h('li', { class: 'fail' }, `오류: ${x.error}`) : null));
  const show = (r) => {
    clear(out); last = r;
    const groupBlock = (g) => h('div', null,
      h('h3', { style: 'margin-top:14px' }, g),
      table(['ID', '시험', '입력 조건', '기대 결과', '결과'],
        r.results.filter((x) => x.group === g).map((x) => [h('b', null, x.id), x.title, x.input, x.expect, resultCell(x)])));
    const summary = callout(r.failed ? 'danger' : '', h('b', null, r.failed ? `${r.failed}건 실패. ` : '모두 통과. '),
      `실패 주입 후 기준선(45 · 40 · 28 · 17)을 복구된 새 상태에서 다시 계산: ${r.baseline_ok ? '일치 ✓' : '불일치 ✗'}`);
    out.append(card(`결과 ${r.passed}/${r.total} 통과`, summary, GROUPS.map(groupBlock)));
  };
  holder.append(h('h1', null, '시스템 시험'),
    callout('', '각 시험은 격리된 메모리 사본(HR 사례)에서 독립 실행됩니다 — 운영 데이터는 건드리지 않습니다. 시험 14개(수량 관계 T1~T4 · 상태 규칙 T5~T8 · 사고 대응 T9~T14), 일부러 망가뜨려 보는 시험 6종(A1~A6), 그리고 교안의 원칙을 코드가 지키는지 보는 원칙 점검(X1~X6).'),
    card('시험 목록', GROUPS.map((g) => h('div', null, h('h3', null, g), table(['ID', '시험', '입력 조건', '기대 결과'], cat.filter((c) => c.group === g).map((c) => [h('b', null, c.id), c.title, c.input, c.expect])))),
      h('div', { class: 'row', style: 'margin-top:12px' }, canRun ? [actionBtn('전체 실행', async () => { show(await api.post('/tests/run', {})); toast('시험을 마쳤습니다.'); }), actionBtn('T1~T14만', async () => show(await api.post('/tests/run', { only: cat.filter((c) => c.id.startsWith('T')).map((c) => c.id) })), { cls: 'ghost' }), actionBtn('A1~A6만', async () => show(await api.post('/tests/run', { only: cat.filter((c) => c.id.startsWith('A')).map((c) => c.id) })), { cls: 'ghost' })] : note('FDE·컨설턴트·운영자가 실행합니다.'))),
    out);
  return holder;
}

export async function renderAudit({ S }) {
  if (!S.engId) return card('사례가 없습니다');
  const id = S.engId; const holder = h('div'); let f = '';
  const body = h('div');
  async function draw() {
    const [rows, v] = await Promise.all([api.get(`/engagements/${id}/audit?limit=200${f ? `&outcome=${f}` : ''}`), api.get('/audit/verify')]);
    clear(body);
    body.append(callout(v.ok ? '' : 'danger', h('b', null, v.ok ? '해시 체인 정상 ' : '해시 체인 불일치 '), v.ok ? `— 처리 기록 ${v.total}건이 변조되지 않았습니다.` : `— #${v.brokenAt} 에서 끊겼습니다(사후 변조 의심).`),
      table(['#', '시각', '누가', '역할', '실행 작업', '대상', '결과', '상세'], rows.map((r) => [r.id, fmtTs(r.ts), r.username, r.role, h('span', { class: 'mono small' }, r.action), r.subject || '', pill(r.outcome === 'ok' ? '성공' : r.outcome === 'denied' ? '권한 거부' : '오류', r.outcome === 'ok' ? 'ok' : 'bad'), h('span', { class: 'tiny' }, typeof r.detail === 'object' && r.detail ? JSON.stringify(r.detail).slice(0, 120) : r.detail || '')])), note('누가 언제 무엇을 등록·수정·승인했는지 남긴 기록이다. 권한 없는 실행 작업의 시도도 ‘권한 거부’로 남는다(T10·T12).'));
  }
  holder.append(h('div', { class: 'row sb' }, h('h1', null, '처리 기록'), h('div', { class: 'row' }, [['', '전체'], ['denied', '권한 거부만'], ['error', '오류만'], ['ok', '성공만']].map(([k, l]) => h('button', { class: 'btn ghost sm', onclick: () => { f = k; draw(); } }, l)))), body);
  await draw();
  return holder;
}
