import { h, card, table, note, callout, pill, tabs, clear, field, textarea, input, select, actionBtn, toast, pct, n, kpi } from '../ui.js';
import * as api from '../api.js';

export async function render({ S, go, rerender }) {
  const t = await S.content('template');
  const ex = await S.content('extras');
  let tab = 'cols';
  const holder = h('div');
  const T = [{ key: 'cols', label: '공통 9열·계산기' }, { key: 'adapters', label: '업종 어댑터' }, { key: 'industries', label: '12개 업종 매핑' }, { key: 'select', label: '과업 선택 점수표' }, { key: 'port', label: '이식·규정' }, { key: 'sheet', label: '워크시트' }, { key: 'examples', label: '가상 예시·사례 라이브러리' }, { key: 'new', label: '새 과업 만들기' }];
  const draw = async () => { clear(holder); holder.append(tabs(T, tab, (k) => { tab = k; draw(); })); holder.append(await views[tab]()); };

  const views = {
    cols: () => h('div', null,
      card('한 과업 템플릿: 공통 9개 열', h('div', { class: 'grid g3' }, t.nine_columns.map((c) => h('div', { class: 'callout', style: 'margin:0' }, h('b', null, c.name), h('div', { class: 'small' }, c.desc)))), note(t.hr_mapping)),
      calculator(t)),
    adapters: async () => {
      const meta = S.meta;
      return h('div', null,
        callout('', '업종 어댑터는 ‘단위 · 상태 정의 · 근거 자료 종류 · 책임자 · 규정’을 업종마다 한 번 정해 두는 층입니다. 코어(판정 엔진·서식·시험)는 그대로 두고 어댑터만 바꿔 다른 업종에 이식합니다.'),
        h('div', { class: 'grid g2' }, meta.adapters.map((a) => card(a.name,
          h('p', { class: 'small' }, h('b', null, '과업: '), a.task_name, ' · ', h('b', null, '단위: '), a.unit, ' · 대상 = ', a.item_label, ' · 범주 = ', a.group_label, ' · 착수 = ', a.start_label),
          table(['요건(‘준비’의 조건)', '근거 자료', '확정 책임자'], a.requirements.map((r) => [r.label, r.source, (a.role_labels && a.role_labels[r.owner]) || meta.roles[r.owner].label])),
          note(`착수 근거 책임자: ${(a.role_labels && a.role_labels[a.start_owner]) || meta.roles[a.start_owner].label}`),
          a.trap ? callout('warn', h('b', null, '완료의 함정: '), a.trap) : null, a.regulations ? note(`규정·민감정보: ${a.regulations}`) : null))),
        S.can('consultant', 'admin') ? newAdapter(S, draw) : note('새 어댑터는 컨설턴트·운영자만 만들 수 있습니다.'));
    },
    industries: () => card('12개 업종 매핑표', table(t.industries.cols, t.industries.rows), note(t.industries.note), h('h3', { style: 'margin-top:16px' }, '컨설팅 영역별 매핑'), table(t.areas.cols, t.areas.rows)),
    select: () => scoreTable(t, S),
    port: () => h('div', null,
      h('div', { class: 'grid g2' }, card('바꾸는 것', h('ul', null, t.change.map((x) => h('li', null, x)))), card('그대로 두는 것', h('ul', null, t.keep.map((x) => h('li', null, x))))), callout('warn', t.no_copy),
      card('상태 정의의 배타성: 한 사람은 한 칸', h('div', { class: 'grid g2' }, h('div', null, h('h4', null, '올바른 정의'), h('ul', { class: 'small' }, t.exclusive.good.map((x) => h('li', null, '✓ ', x)))), h('div', null, h('h4', null, '깨진 정의'), h('ul', { class: 'small' }, t.exclusive.broken.map((x) => h('li', null, '✗ ', x))))), note(t.exclusive.warn, 'warn')),
      card('규정과 민감정보: 업종 공통 점검 4가지', h('div', { class: 'grid g4' }, t.regulations.map((r) => h('div', { class: 'callout', style: 'margin:0' }, h('b', null, r.title), h('div', { class: 'small' }, r.desc))))),
      card('과제', h('ol', null, t.homework.map((x) => h('li', null, x))))),
    sheet: () => worksheet(t, S),
    examples: async () => {
      const list = S.engs;
      return h('div', null,
        card('가상 예시 2건 — 같은 코어, 다른 어댑터', h('div', { class: 'grid g2' }, t.examples.map((e) => { const eng = list.find((x) => x.request_code === e.request_code); return h('div', { class: 'callout', style: 'margin:0' }, h('b', null, e.title), eng ? h('div', { class: 'small' }, `입력 ${eng.counts.input} = 착수 ${eng.counts.started} + 예비 ${eng.counts.reserve} · 완료 ${eng.counts.completed} = 승인 ${eng.counts.approved} + 검토 ${eng.counts.review} + 미확인 ${eng.counts.unconfirmed} · 부족 ${eng.metrics.shortage}`) : null, h('div', { class: 'small muted' }, e.note), eng ? h('button', { class: 'btn sm', style: 'margin-top:8px', onclick: () => { S.engId = eng.id; S.invalidate(); go('dash'); } }, '이 사례 열기') : null); })), note('템플릿·예시는 강사 설계이며 원문 사례가 아니다. 수치는 교육용 가상 값이다.')),
        card('사례 라이브러리', table(['업종', '장', '사례', '상태', '비고'], ex.case_library.map((c) => [c.industry, c.chapter ?? '—', c.title, pill(c.status, c.status === '수록' ? 'ok' : 'neutral'), c.note])), note(ex.canonical_scheme.note), note(ex.canonical_scheme.disclaimer, 'warn')));
    },
    new: () => S.can('consultant', 'admin') ? newCase(S, go) : card('새 과업 만들기', note('컨설턴트·운영자만 새 과업을 만들 수 있습니다. 컨설턴트 역할로 로그인해 보세요.')),
  };
  await draw();
  return holder;
}

function calculator(t) {
  const keys = [['required', '요구'], ['input', '입력'], ['started', '착수'], ['reserve', '예비'], ['completed', '완료'], ['in_progress', '진행'], ['approved', '승인'], ['review', '검토'], ['unconfirmed', '미확인']];
  const v = { required: 45, input: 45, started: 40, reserve: 5, completed: 40, in_progress: 0, approved: 28, review: 8, unconfirmed: 4 };
  const out = h('div');
  const calc = () => {
    clear(out);
    const R = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);
    const eq = [['① 입력 = 착수 + 예비', v.input, v.started + v.reserve], ['② 착수 = 완료 + 진행', v.started, v.completed + v.in_progress], ['③ 완료 = 승인 + 검토 + 미확인', v.completed, v.approved + v.review + v.unconfirmed]];
    eq.forEach(([l, a, b]) => out.append(h('div', { class: 'eq' }, h('b', null, l), h('span', { class: 'term' }, `${a} ↔ ${b}`), h('span', { class: `resid ${a === b ? 'ok' : 'bad'}` }, a === b ? '잔차 0 ✓ 일치' : `잔차 ${a - b} ✗ 불일치`))));
    out.append(h('div', { class: 'grid g4', style: 'margin-top:8px' },
      kpi('완료율 (완료 ÷ 착수)', null, '', pct(R(v.completed, v.started))), kpi('승인율 (승인 ÷ 완료)', null, '', pct(R(v.approved, v.completed))),
      kpi('요구 충족률 (승인 ÷ 요구)', null, '', pct(R(v.approved, v.required))), kpi('부족 (요구 − 승인)', v.required - v.approved, 'k-shortage')));
    out.querySelectorAll('.kpi').forEach((k, i) => { if (i < 3) { const val = [R(v.completed, v.started), R(v.approved, v.completed), R(v.approved, v.required)][i]; k.querySelector('.v').textContent = val == null ? '—' : `${val.toFixed(2)}%`; k.querySelector('.d').textContent = val == null ? '분모 0 — 임의로 100%라고 적지 않는다' : ''; } });
  };
  const inputs = h('div', { class: 'grid g5' }, keys.map(([k, l]) => { const i = h('input', { type: 'number', min: '0', value: String(v[k]), 'aria-label': l, oninput: (e) => { v[k] = Math.max(0, Math.floor(Number(e.target.value) || 0)); calc(); } }); return h('div', null, h('label', null, l), i); }));
  calc();
  return card('세 계산 확인식과 네 지표 (빈칸 템플릿)', note('값을 바꿔 보세요. 사례 기본값은 45 · 40 · 28. 착수를 0으로 만들면 완료율의 분모가 0이 되어 ‘산출 불가’가 됩니다.'), inputs, out, note(t.metrics_note));
}

function scoreTable(t, S) {
  const sc = {}; const out = h('div', { class: 'callout' }); const rows = h('div');
  const upd = () => { const sum = Object.values(sc).reduce((a, b) => a + b, 0); const all = Object.keys(sc).length === t.score_criteria.length; out.textContent = all ? `합계 ${sum}/10점 — ${sum >= t.score_pass ? `${t.score_pass}점 이상: 시범 과업으로 적합합니다.` : `${t.score_pass}점 미만: 과업 범위를 쪼개거나 다른 과업을 고르세요.`}` : `채점 중… (${Object.keys(sc).length}/${t.score_criteria.length})`; };
  t.score_criteria.forEach((c) => rows.append(h('div', { class: 'row', style: 'padding:6px 0;border-bottom:1px solid var(--line)' }, h('div', { style: 'flex:1 1 260px' }, h('b', null, c.name), h('div', { class: 'small muted' }, c.q)),
    ...[[0, c.zero], [1, '중간'], [2, c.two]].map(([p, l]) => h('label', { class: 'row', style: 'margin:0;font-weight:400' }, h('input', { type: 'radio', name: `sc-${c.key}`, onchange: () => { sc[c.key] = p; upd(); } }), `${p}점 · ${l}`)))));
  upd();
  return h('div', null, card('과업 선택 흐름도', h('div', { class: 'pipeline' }, t.selection_flow.map((q, i) => h('div', { class: 'step' }, h('b', null, `${i + 1}`), q)), h('div', { class: 'step on' }, h('b', null, '과업 확정'), '모두 예')), note(t.selection_fail)), card('과업 선택 점수표 (0·1·2점)', rows, out, note(t.score_note)));
}

async function worksheet(t, S) {
  const prog = await api.get('/learn/progress');
  const inputs = {}; let curId = null;
  const form = h('div', null, t.worksheet_fields.map((f) => { const ta = textarea('', { rows: '2' }); inputs[f.key] = ta; return field(f.label, ta); }));
  const title = input('text', '', { placeholder: '워크시트 제목(예: 우리 고객사 — 신규 상품 진열)' });
  const list = h('div');
  const showList = (ws) => { clear(list); if (!ws.length) list.append(h('p', { class: 'muted small' }, '저장된 워크시트가 없습니다.')); ws.forEach((w) => list.append(h('div', { class: 'row sb', style: 'padding:6px 0;border-bottom:1px solid var(--line)' }, h('span', null, h('b', null, w.title), h('span', { class: 'tiny muted' }, ` · ${String(w.updated_at).slice(0, 10)}`)),
    h('span', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => { curId = w.id; title.value = w.title; t.worksheet_fields.forEach((f) => { inputs[f.key].value = w.data[f.key] || ''; }); } }, '불러오기'), actionBtn('삭제', async () => { await api.del(`/learn/worksheets/${w.id}`); toast('삭제했습니다.'); const p = await api.get('/learn/progress'); showList(p.worksheets); }, { cls: 'ghost sm', confirm: '삭제할까요?' }))))); };
  showList(prog.worksheets);
  return h('div', null, card('업종 적용 워크시트 (빈 서식)', note('빈칸은 미확정으로 표시하세요. 빈칸을 0이나 합격으로 바꾸지 않습니다.'), field('제목', title), form,
    h('div', { class: 'row', style: 'margin-top:10px' }, actionBtn('저장', async () => {
      const data = Object.fromEntries(t.worksheet_fields.map((f) => [f.key, inputs[f.key].value]));
      const r = await api.post('/learn/worksheets', { id: curId, title: title.value, data }); curId = r.id; toast('저장했습니다.');
      const p = await api.get('/learn/progress'); showList(p.worksheets);
    }), h('button', { class: 'btn ghost', onclick: () => { curId = null; title.value = ''; Object.values(inputs).forEach((i) => { i.value = ''; }); } }, '새로 작성'))), card('내 워크시트', list));
}

function newAdapter(S, redraw) {
  const roles = Object.keys(S.meta.roles).filter((r) => !['admin', 'learner'].includes(r)).map((r) => [r, S.meta.roles[r].label]);
  const f = { key: input('text', '', { placeholder: 'retail-listing' }), name: input('text', '', { placeholder: '도소매·유통 — 신규 상품 진열' }), industry: input('text', '', { placeholder: '도소매·유통' }), task_name: input('text', '', { placeholder: '신규 상품 진열 확인' }), unit: input('text', '', { placeholder: '종' }), item_label: input('text', '', { placeholder: '상품' }), group_label: input('text', '', { placeholder: '매대' }), start_label: input('text', '', { placeholder: '입고' }), start_owner: select(roles, 'manager'), trap: input('text', '', { placeholder: '입고 완료 ≠ 판매 가능' }) };
  const reqRows = []; const reqBox = h('div');
  const addReq = (k = '', l = '', s = '', o = 'manager') => { const row = { key: input('text', k, { placeholder: 'INSPECT', style: 'text-transform:uppercase' }), label: input('text', l, { placeholder: '검수' }), source: input('text', s, { placeholder: '검수 기록' }), owner: select(roles, o) }; reqRows.push(row); reqBox.append(h('div', { class: 'field-row' }, field('요건 키(영대문자)', row.key), field('요건 이름', row.label), field('근거 자료', row.source), field('확정 책임자', row.owner))); };
  addReq('INSPECT', '검수', '검수 기록', 'manager'); addReq('PRICE', '가격 등록', '가격표', 'it'); addReq('DISPLAY', '진열 확인', '진열 점검표', 'field');
  return card('새 업종 어댑터 만들기', note('코어는 그대로 두고 단위·상태 정의·근거 자료·책임자·규정만 정합니다. ‘준비’의 요건은 3~5개가 적당합니다.'),
    h('div', { class: 'field-row' }, field('어댑터 키', f.key, '영소문자·숫자·-_', true), field('이름', f.name, null, true), field('업종', f.industry, null, true), field('과업명', f.task_name, null, true), field('단위', f.unit, null, true), field('대상 이름', f.item_label, null, true), field('범주 이름', f.group_label, null, true), field('착수의 업종 언어', f.start_label, null, true), field('착수 근거 책임자', f.start_owner)),
    field('완료의 함정', f.trap), h('h4', { style: 'margin-top:12px' }, '‘준비’의 요건'), reqBox,
    h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => { if (reqRows.length < 5) addReq(); } }, '+ 요건 추가'), actionBtn('어댑터 저장', async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])); body.requirements = reqRows.map((r) => ({ key: r.key.value.trim().toUpperCase(), label: r.label.value, source: r.source.value, owner: r.owner.value }));
      await api.post('/adapters', body); toast('어댑터를 만들었습니다.'); S.meta = await api.get('/meta'); redraw();
    })));
}

function newCase(S, go) {
  const ad = S.meta.adapters.map((a) => [a.key, a.name]);
  const f = { request_code: input('text', '', { placeholder: 'X-100' }), task_code: input('text', '', { placeholder: 'XX-001' }), title: input('text', '', { placeholder: '(가상) 우리 고객사 …' }), adapter_key: select(ad, ad[0] && ad[0][0]), basis_date: input('date', new Date().toISOString().slice(0, 10)) };
  const groups = textarea('A,라인 A,10\nB,라인 B,8', { rows: '4' });
  return card('새 과업 만들기', note('요청 번호·과업 번호·기준 시점·하위 범주(요구 수량)를 정합니다. 대상과 근거는 만든 뒤 ‘대상·근거’ 화면에서 수집(CSV)합니다. 새 과업은 기본으로 교육용 가상 표시가 붙습니다.'),
    h('div', { class: 'field-row' }, field('요청 번호', f.request_code, null, true), field('과업 번호', f.task_code, null, true), field('제목', f.title, null, true), field('업종 어댑터', f.adapter_key), field('기준 시점', f.basis_date, null, true)),
    field('하위 범주 (한 줄에 코드,이름,요구 수량)', groups, null, true),
    actionBtn('과업 만들기', async () => {
      const gs = groups.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [code, name, req] = l.split(',').map((x) => x.trim()); return { code, name, required: Number(req) }; });
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])); body.groups = gs;
      const r = await api.post('/engagements', body); await S.refreshList(); S.engId = r.id; S.invalidate(); toast('과업을 만들었습니다. 대상·근거 화면에서 자료를 수집하세요.'); go('items');
    }));
}
