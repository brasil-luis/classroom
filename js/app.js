/* ClassroomControl — interface. Rotas por hash:
 *   #/                         turmas (ativas) e projetos
 *   #/pessoas                  alunos de todas as turmas
 *   #/p/{id}[/calendario]      projeto: disciplinas; calendário letivo
 *   #/d/{id}                   disciplina: turmas
 *   #/t/{id}/chamada[/{aula}]  chamada
 *   #/t/{id}/alunos            alunos
 *   #/t/{id}/aluno/{aluno}     histórico de um aluno
 *   #/t/{id}/cronograma        aulas
 *   #/t/{id}/notas[/{aval}]    notas
 *   #/t/{id}/resumo            faltas, médias, situação
 */
(function () {
  'use strict';
  const CC = window.CC;
  const VERSAO = '0.9.0';
  const KEY = 'classroomcontrol.v1';
  const $ = sel => document.querySelector(sel);
  const app = $('#app');

  /* ---------- armazenamento ---------- */

  /* Os dados vão para o IndexedDB (cabe bem mais: dezenas de turmas antigas) e, enquanto couber, também
   * para o localStorage, que é lido na hora ao abrir. Quando não cabe mais, fica só no IndexedDB. */
  const KEY_IDB = KEY + '.so-idb';
  let aguardandoIDB = false;
  let db = carregar();
  let salvarTimer = null;

  function normalizarDb(dados) {
    dados.turmas = dados.turmas || [];
    dados.turmas.forEach(t => { t.config = Object.assign({}, CC.DEFAULT_CONFIG, t.config); delete t.config.totalAulas; });
    return CC.organizar(dados);   // projetos e disciplinas (bancos antigos: criados a partir das turmas)
  }

  function carregar() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalizarDb(JSON.parse(raw));
      aguardandoIDB = !!localStorage.getItem(KEY_IDB);
    } catch (e) { console.error(e); }
    return { versao: 1, turmas: [], projetos: [], disciplinas: [] };
  }

  let idbPromessa = null;
  function idb() {
    if (!idbPromessa) {
      idbPromessa = new Promise((ok, erro) => {
        const r = indexedDB.open('classroomcontrol-dados', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => erro(r.error);
      });
    }
    return idbPromessa;
  }
  async function idbGravar(json) {
    const d = await idb();
    return new Promise((ok, erro) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(json, 'db');
      tx.oncomplete = () => ok();
      tx.onerror = () => erro(tx.error);
    });
  }
  async function idbLer() {
    const d = await idb();
    return new Promise((ok, erro) => {
      const r = d.transaction('kv').objectStore('kv').get('db');
      r.onsuccess = () => ok(r.result || null);
      r.onerror = () => erro(r.error);
    });
  }

  function gravarAgora() {
    if (aguardandoIDB) return;          // ainda não leu o IndexedDB: não sobrescrever com dados vazios
    db.salvoEm = Date.now();
    const json = JSON.stringify(db);
    let local = true;
    try { localStorage.setItem(KEY, json); localStorage.removeItem(KEY_IDB); }
    catch (e) {
      local = false;
      try { localStorage.removeItem(KEY); localStorage.setItem(KEY_IDB, String(db.salvoEm)); } catch (e2) { /* nada */ }
    }
    if (window.indexedDB) idbGravar(json).catch(e => { if (!local) toast('Não consegui salvar no aparelho: ' + e.message); });
    else if (!local) toast('Não consegui salvar no aparelho (sem espaço).');
  }

  function salvar() {
    clearTimeout(salvarTimer);
    salvarTimer = setTimeout(gravarAgora, 150);
  }

  window.addEventListener('pagehide', () => { clearTimeout(salvarTimer); gravarAgora(); });

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  function turma(id) { return db.turmas.find(t => t.id === id); }

  /** Tabela código → curso: a editada pelo usuário ou, se não houver, a da UFF (cursos-uff.js). */
  function cursos(t) {
    if (t && !CC.ehUFF(t)) return null;   // outra instituição: a matrícula não diz o curso
    return db.cursos || window.CURSOS_UFF || {};
  }

  function limTxt(t) {
    const l = CC.limiteFaltas(t);
    return CC.numBR(l, l % 1 ? 1 : 0);
  }

  function cursoDe(t, a) {
    return CC.cursoAluno(t, a, cursos(t));
  }

  /* ---------- utilitários de UI ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function nomeCurto(nome) {
    return CC.titleCase(nome || '');
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /** Abre o diálogo; resolve com o botão clicado (value) e os campos do formulário. */
  /** Fecha o diálogo aberto e espera o evento "close" (que é assíncrono), para ele não
   *  ser confundido com o fechamento do próximo diálogo. */
  function fecharDialogo() {
    const dlg = $('#dlg');
    if (!dlg.open) return Promise.resolve();
    return new Promise(ok => { dlg.addEventListener('close', () => ok(), { once: true }); dlg.close(); });
  }

  async function dialogo(html, aoAbrir) {
    await fecharDialogo();
    const dlg = $('#dlg'), form = $('#dlg-form');
    form.innerHTML = html;
    return new Promise(resolve => {
      const fechar = () => {
        dlg.removeEventListener('close', fechar);
        const dados = {};
        new FormData(form).forEach((v, k) => {
          if (k in dados) dados[k] = [].concat(dados[k], v); else dados[k] = v;
        });
        resolve({ acao: dlg.returnValue, dados, form });
      };
      dlg.addEventListener('close', fechar);
      dlg.returnValue = '';
      dlg.showModal();
      if (aoAbrir) aoAbrir(form);
      const foco = form.querySelector('[autofocus]');
      if (foco) foco.focus();
    });
  }

  function confirmar(titulo, texto, botao, perigo) {
    return dialogo(`<h2>${esc(titulo)}</h2><p>${texto}</p>
      <div class="acoes"><button class="btn" value="">Cancelar</button>
      <button class="btn ${perigo ? 'danger' : 'primary'}" value="ok">${esc(botao || 'OK')}</button></div>`)
      .then(r => r.acao === 'ok');
  }

  /**
   * Escolhe um arquivo para importar. Com pasta de trabalho, mostra antes os arquivos dela
   * (do mais recente ao mais antigo); "Outro arquivo…" abre o seletor do sistema.
   */
  async function escolherArquivo(accept, varios, t) {
    const exts = accept.split(',').map(x => x.trim().toLowerCase()).filter(x => x.startsWith('.'));
    if (!varios && exts.length && Pasta.suportada) {
      const pasta = await Pasta.da(t);
      if (pasta) {
        let arqs = [], dir = pasta.handle;
        const sub = subpastaDe(pasta, t);
        try {
          if (sub) dir = await pasta.handle.getDirectoryHandle(sub);
          arqs = await Pasta.listar(dir, exts);
        } catch (e) { /* pasta indisponível */ }
        const r = await dialogo(`<h2>Abrir de “${esc(pasta.handle.name + (sub ? '/' + sub : ''))}”</h2>
          ${arqs.length ? `<ul class="menu-list arquivos">${arqs.slice(0, 40).map((a, i) => `<li><button value="${i}">${esc(a.nome)}<span class="muted small">${new Date(a.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span></button></li>`).join('')}</ul>`
            : `<p class="muted">Nenhum arquivo ${exts.join(' / ')} nesta pasta.</p>`}
          <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn" value="outro">Outro arquivo…</button></div>`);
        if (r.acao === '') return null;
        if (r.acao !== 'outro') return arqs[+r.acao].handle.getFile();
      }
    }
    return escolherDoSistema(accept, varios);
  }

  /** Abre o seletor de arquivos do sistema; com `varios`, devolve uma lista. */
  function escolherDoSistema(accept, varios) {
    const input = $('#file-input');
    input.value = '';
    input.webkitdirectory = false;
    input.accept = accept;
    input.multiple = !!varios;
    return new Promise(resolve => {
      input.onchange = () => resolve(varios ? Array.from(input.files) : (input.files[0] || null));
      input.click();
    });
  }

  function lerPlanilha(file) {
    return file.arrayBuffer().then(buf => {
      if (!window.XLSX) throw new Error('Biblioteca de planilhas não carregou (abra o app uma vez com internet).');
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const p = CC.parseWorkbook(XLSX, wb);
      Object.defineProperty(p, 'wb', { value: wb });   // para escolher as colunas à mão, se preciso
      return p;
    });
  }

  const letraCol = c => XLSX.utils.encode_col(c);

  /**
   * Importação assistida: a pessoa escolhe a aba, a linha dos títulos e as colunas de matrícula, nome,
   * e-mail e CPF (datas e notas são lidas da linha dos títulos). Devolve a planilha lida ou null.
   */
  async function escolherColunas(wb, nomeArq) {
    const matriz = aba => XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: false, defval: '' });
    const palpite = m => {
      const linhas = m.slice(0, 60), ncol = Math.max(0, ...linhas.map(r => r.length));
      const conta = re => Array.from({ length: ncol }, (_, c) => linhas.filter(r => re.test(String(r[c] || '').trim())).length);
      const melhor = arr => { const mx = Math.max(0, ...arr); return mx >= 2 ? arr.indexOf(mx) : -1; };
      const nome = melhor(conta(/^[A-Za-zÀ-ÿ]{2,}(\s+[A-Za-zÀ-ÿ.]{1,})+$/));
      const mat = melhor(conta(/^([A-Za-z]?\d[\d.\-]{5,14}\d)$/));
      const email = melhor(conta(/@/));
      const prim = linhas.findIndex(r => nome >= 0 && /^[A-Za-zÀ-ÿ]{2,}\s+[A-Za-zÀ-ÿ]/.test(String(r[nome] || '')));
      return { linha: prim > 0 ? prim : 0, mat, nome, email, cpf: -1 };
    };
    const opcoesCol = (m, sel) => {
      const ncol = Math.max(1, ...m.slice(0, 30).map(r => r.length));
      return '<option value="-1">—</option>' + Array.from({ length: ncol }, (_, c) => {
        const ex = (m.slice(0, 30).map(r => String(r[c] || '').trim()).find(Boolean) || '').slice(0, 18);
        return `<option value="${c}" ${c === sel ? 'selected' : ''}>${letraCol(c)}${ex ? ' · ' + esc(ex) : ''}</option>`;
      }).join('');
    };
    const previa = m => '<table class="previa"><tbody>' + m.slice(0, 8).map((r, i) => `<tr><th>${i + 1}</th>` +
      Array.from({ length: Math.min(10, Math.max(...m.slice(0, 8).map(x => x.length), 1)) }, (_, c) => `<td>${esc(String(r[c] || '').slice(0, 16))}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
    const opcoes = d => ({ aba: d.aba, cabecalho: { row: (parseInt(d.linha, 10) || 0) - 1, mat: +d.mat, nome: +d.nome, email: +d.email, cpf: +d.cpf } });
    const aba0 = wb.SheetNames[0];
    const r = await dialogo(`<h2>Escolher colunas</h2>
      <p class="muted small">${esc(nomeArq)}: o app não reconheceu o cabeçalho. Diga onde estão os dados; datas e notas são lidas da linha dos títulos.</p>
      <label class="field">Aba<select name="aba">${wb.SheetNames.map(n => `<option>${esc(n)}</option>`).join('')}</select></label>
      <div class="previa-box" id="previa"></div>
      <label class="field">Linha dos títulos (0 se não houver)<input type="number" name="linha" min="0" value="0"></label>
      <div class="row" id="cols"></div>
      <p class="small" id="conta-cols"></p>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Usar</button></div>`,
    form => {
      const aba = form.querySelector('[name=aba]');
      const desenhar = (novaAba) => {
        const m = matriz(aba.value);
        if (novaAba) {
          const g = palpite(m);
          form.querySelector('[name=linha]').value = g.linha;
          form.querySelector('#cols').innerHTML = [['mat', 'Matrícula', g.mat], ['nome', 'Nome', g.nome], ['email', 'E-mail', g.email], ['cpf', 'CPF', g.cpf]]
            .map(([k, rot, sel]) => `<label class="field grow">${rot}<select name="${k}">${opcoesCol(m, sel)}</select></label>`).join('');
          form.querySelector('#previa').innerHTML = previa(m);
        }
        const dados = {}; new FormData(form).forEach((v, k) => { dados[k] = v; });
        let p = null;
        try { if (+dados.nome >= 0 || +dados.mat >= 0) p = CC.parseWorkbook(XLSX, wb, opcoes(dados)); } catch (e) { /* combinação inválida */ }
        form.querySelector('#conta-cols').textContent = p ? `${p.alunos.length} aluno(s), ${p.datas.length} data(s) de chamada, ${p.notas.length} coluna(s) de notas.` : 'Escolha ao menos a coluna do nome ou da matrícula.';
      };
      aba.addEventListener('change', () => desenhar(true));
      form.addEventListener('change', e => { if (e.target !== aba) desenhar(false); });
      form.addEventListener('input', e => { if (e.target.name === 'linha') desenhar(false); });
      aba.value = aba0; desenhar(true);
    });
    if (r.acao !== 'ok') return null;
    const p = CC.parseWorkbook(XLSX, wb, opcoes(r.dados));
    Object.defineProperty(p, 'wb', { value: wb });
    if (!p.alunos.length) { toast('Nenhum aluno com essas colunas.'); return null; }
    return p;
  }

  /** Lê a planilha; se não achar alunos, oferece escolher as colunas à mão. */
  async function lerComAjuda(file) {
    let p;
    try { p = await lerPlanilha(file); } catch (e) { toast('Erro ao ler: ' + e.message); return null; }
    if (p.alunos.length) return p;
    const ok = await confirmar('Lista não reconhecida', `${esc(p.avisos[0] || 'Não encontrei alunos nessa planilha.')} Quer indicar as colunas à mão?`, 'Escolher colunas');
    return ok ? escolherColunas(p.wb, file.name) : null;
  }

  /** Subpasta da disciplina dentro da pasta do projeto (padrão UFF-código-sigla), quando é a pasta do projeto. */
  function subpastaDe(pasta, t) {
    const d = t && CC.disciplinaDe(db, t);
    return pasta && pasta.chave.startsWith('p:') && d && d.pasta ? d.pasta : '';
  }

  /** Entrega um arquivo gerado: na pasta de trabalho, "salvar como", compartilhar ou baixar.
   *  nomeNaPasta: nome a usar dentro da pasta da disciplina (na pasta do projeto). */
  async function entregarArquivo(blob, nome, t, nomeNaPasta) {
    const pasta = await Pasta.da(t);
    const sub = subpastaDe(pasta, t);
    if (sub && nomeNaPasta) nome = nomeNaPasta;
    const file = new File([blob], nome, { type: blob.type });
    const podeCompartilhar = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    const opcoes = [];
    if (pasta) opcoes.push(['pasta', `Salvar em “${pasta.handle.name}${sub ? '/' + sub : ''}”`]);
    if (Pasta.suportaSalvarComo) opcoes.push(['salvarcomo', 'Salvar como… (escolher o local)']);
    if (podeCompartilhar) opcoes.push(['compartilhar', 'Compartilhar… (Drive, e-mail…)']);
    opcoes.push(['baixar', 'Baixar (pasta Downloads)']);
    const r = await dialogo(`<h2>Arquivo pronto</h2><p class="muted">${esc(nome)}</p>
      <div class="stack">${opcoes.map((o, i) => `<button class="btn block ${i ? '' : 'primary'}" value="${o[0]}">${esc(o[1])}</button>`).join('')}</div>
      ${!pasta && Pasta.suportada ? '<p class="muted small" style="margin-top:12px">Dica: escolha uma pasta de trabalho (menu ⋮) para salvar direto nela.</p>' : ''}
      <div class="acoes"><button class="btn" value="">Cancelar</button></div>`);
    if (r.acao === 'pasta') {
      try {
        let destino = nome;
        const dir = sub ? await pasta.handle.getDirectoryHandle(sub, { create: true }) : pasta.handle;
        if (await Pasta.existe(dir, nome)) {
          const comData = nome.replace(/(\.[a-z]+)$/i, '-' + CC.todayISO() + '$1');
          const q = await dialogo(`<h2>Arquivo já existe</h2><p><b>${esc(nome)}</b> já está em “${esc(pasta.handle.name)}”. Se você ajustou essa planilha no Excel, substituir apaga os ajustes.</p>
            <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn" value="data">Salvar como ${esc(comData)}</button><button class="btn danger" value="subst">Substituir</button></div>`);
          if (!q.acao) return;
          if (q.acao === 'data') destino = comData;
        }
        await Pasta.gravar(dir, destino, blob);
        return toast(`Salvo em ${pasta.handle.name}/${sub ? sub + '/' : ''}${destino}`);
      } catch (e) { return toast('Não consegui gravar na pasta: ' + e.message); }
    }
    if (r.acao === 'salvarcomo') {
      const inicio = Date.now();
      try { const n = await Pasta.salvarComo(nome, blob, pasta && pasta.handle); return toast('Salvo: ' + n); }
      catch (e) { seletorFalhou(e, inicio, 'a janela para escolher onde salvar'); return; }
    }
    if (r.acao === 'compartilhar') {
      try { await navigator.share({ files: [file], title: nome }); } catch (e) { /* cancelado */ }
      return;
    }
    if (r.acao !== 'baixar') return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------- roteamento ---------- */

  function go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  }

  window.addEventListener('hashchange', () => {
    // Botão "voltar" do Android com um diálogo aberto: fecha o diálogo.
    const dlg = $('#dlg');
    if (dlg.open) dlg.close();
    render();
  });

  function setTopo(titulo, sub, voltar, menu) {
    $('#titulo').textContent = titulo;
    $('#subtitulo').textContent = sub || '';
    document.title = titulo === 'Chamada' ? 'Chamada' : titulo + ' · Chamada';
    $('#btn-voltar').hidden = !voltar;
    $('#btn-voltar').onclick = () => go(voltar);
    $('#btn-menu').hidden = !menu;
    $('#btn-menu').onclick = menu || null;
  }

  function setTabs(t, ativa) {
    const tabs = $('#tabs');
    if (!t) { tabs.hidden = true; return; }
    tabs.hidden = false;
    const itens = [['chamada', 'Chamada'], ['alunos', 'Alunos'], ['cronograma', 'Aulas'], ['notas', 'Notas'], ['resumo', 'Resumo']];
    tabs.innerHTML = itens.map(([k, l]) => `<a href="#/t/${t.id}/${k}" class="${k === ativa ? 'on' : ''}">${l}</a>`).join('');
  }

  function render() {
    const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    window.scrollTo(0, 0);
    if (partes[0] === 'pessoas') return telaPessoas(decodeURIComponent(partes[1] || ''));
    if (partes[0] === 'p') {
      const p = projeto(partes[1]);
      if (!p) return go('#/');
      return partes[2] === 'calendario' ? telaCalendario(p) : telaProjeto(p);
    }
    if (partes[0] === 'd') {
      const d = disciplina(partes[1]);
      return d ? telaDisciplina(d) : go('#/');
    }
    if (partes[0] !== 't') return telaTurmas();
    const t = turma(partes[1]);
    if (!t) return go('#/');
    const tela = partes[2] || 'chamada';
    const arg = partes[3];
    setTabs(t, tela === 'aluno' ? 'alunos' : tela);
    const voltar = t.disciplinaId && (t.arquivada || contexto.disciplinaId === t.disciplinaId) ? '#/d/' + t.disciplinaId : '#/';
    setTopo(t.codigo ? (t.codigo + (t.turma ? ' ' + t.turma : '')) : t.disciplina,
      (t.codigo ? CC.disciplinaTema(t) : t.periodo) + (t.arquivada ? ' · arquivada' : ''), voltar, () => menuTurma(t));
    ({ chamada: telaChamada, alunos: telaAlunos, aluno: telaAluno, cronograma: telaCronograma, notas: telaNotas, resumo: telaResumo }[tela] || telaChamada)(t, arg);
  }

  /* ---------- tela: alunos de todas as turmas (pessoas, pelo CPF) ---------- */

  function telaPessoas(busca) {
    setTabs(null);
    setTopo('Alunos', 'De todas as turmas', '#/', menuGeral);
    const todas = CC.pessoasDe(db.turmas);
    app.innerHTML = `<div class="card"><input type="search" id="busca-pessoa" placeholder="Nome, matrícula, CPF ou e-mail" value="${esc(busca)}" style="width:100%">
      <p class="muted small" id="conta-pessoas"></p></div><div id="lista-pessoas"></div>`;
    const desenhar = () => {
      const q = CC.norm($('#busca-pessoa').value);
      const lista = !q ? todas : todas.filter(g => CC.norm(g.nome).includes(q) || g.cpf.includes(q) || g.matriculas.some(m => m.includes(q)) ||
        g.itens.some(i => (i.a.email || '').toUpperCase().includes(q)));
      $('#conta-pessoas').textContent = `${lista.length} de ${todas.length} pessoa(s) · ${todas.filter(g => g.cpf).length} com CPF · ${todas.filter(g => g.itens.length > 1).length} em mais de uma turma`;
      $('#lista-pessoas').innerHTML = lista.slice(0, 200).map(g => `<div class="card pessoa"><b>${esc(nomeCurto(g.nome))}</b>
        <span class="muted small">${g.cpf ? 'CPF ' + esc(g.cpf.slice(0, 3)) + '.***.***-' + esc(g.cpf.slice(9)) : 'sem CPF'}${g.matriculas.length ? ' · ' + esc(g.matriculas.join(', ')) : ''}</span>
        <div class="chips">${g.itens.map(({ t, a }) => `<a class="tag" href="#/t/${t.id}/aluno/${a.id}">${esc(CC.periodoCurto(t.periodo) || '?')} ${esc(CC.siglaDisciplina(t.tema || t.disciplina) || t.codigo)}${a.ativo ? '' : ' (saiu)'}</a>`).join(' ')}</div></div>`).join('') +
        (lista.length > 200 ? `<p class="muted small" style="text-align:center">Mostrando 200; refine a busca.</p>` : '');
    };
    $('#busca-pessoa').addEventListener('input', desenhar);
    desenhar();
  }

  /* ---------- projetos e disciplinas ---------- */

  // Última tela de projeto/disciplina visitada: turmas criadas a partir dali entram nela.
  let contexto = { projetoId: null, disciplinaId: null };

  function projeto(id) { return db.projetos.find(p => p.id === id); }
  function disciplina(id) { return db.disciplinas.find(d => d.id === id); }
  const ordemPeriodo = t => String(CC.chavePeriodo(t.periodo) || t.periodo || '');
  const periodoDeHoje = () => (d => d.getFullYear() + '-' + (d.getMonth() < 7 ? '1' : '2'))(new Date());
  const periodoAtualNum = () => periodoDeHoje().replace('-', '');
  const turmasDoProjeto = p => db.turmas.filter(t => t.projetoId === p.id);

  function maisComum(lista) {
    const n = {};
    lista.forEach(x => { n[x] = (n[x] || 0) + 1; });
    return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || '';
  }

  function resumoProjeto(p) {
    const ts = turmasDoProjeto(p), ativas = ts.filter(t => !t.arquivada).length;
    return `${CC.disciplinasDoProjeto(db, p).length} disciplina(s) · ${ts.length} turma(s)${ativas ? ` · ${ativas} ativa(s)` : ''}`;
  }

  function cartaoProjeto(p) {
    return `<a class="card turma-card" href="#/p/${p.id}"><div class="muted small">${esc([p.instituicao, p.departamento].filter(Boolean).join(' · '))}</div>
      <h2>${esc(p.nome)}</h2><div class="muted small">${resumoProjeto(p)}</div></a>`;
  }

  /** Regras do projeto (frequência e médias) numa turma nova. */
  function herdarRegras(t, p) {
    if (p) CC.REGRAS.forEach(k => { if (p.config[k] !== undefined) t.config[k] = p.config[k]; });
  }

  /** Disciplina recém-criada por uma turma: nome e nível pelas turmas/alunos. */
  function ajustarSeNova(t) {
    const d = CC.disciplinaDe(db, t);
    if (d && CC.turmasDaDisciplina(db, d).length === 1) CC.ajustarDisciplina(db, d);
  }

  /** Campo "Projeto" (com a opção de criar um novo) para os diálogos de turma. Ligar com ligarProjeto. */
  function campoProjeto(pid) {
    const sel = [pid, contexto.projetoId, db.projetoPadrao].find(x => x && projeto(x)) || (db.projetos[0] ? db.projetos[0].id : 'novo');
    return `<label class="field">Projeto<select name="projetoId" id="sel-projeto">
      ${db.projetos.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}
      <option value="novo" ${sel === 'novo' ? 'selected' : ''}>Novo projeto…</option></select></label>
      <div class="row nowrap" id="novo-projeto" hidden><label class="field grow">Instituição<input type="text" name="instituicao" value="UFF"></label>
      <label class="field grow">Departamento<input type="text" name="departamento" placeholder="opcional"></label></div>`;
  }

  function ligarProjeto(form) {
    const s = form.querySelector('#sel-projeto'), box = form.querySelector('#novo-projeto');
    if (!s || !box) return;
    const sync = () => { box.hidden = s.value !== 'novo'; };
    s.addEventListener('change', sync);
    sync();
  }

  /** Projeto escolhido no diálogo (cria o novo, se for o caso). */
  function projetoDoForm(d) {
    const p = d.projetoId && d.projetoId !== 'novo' && projeto(d.projetoId);
    if (p) return p;
    const novo = CC.novoProjeto({ nome: d.projNome, instituicao: d.instituicao || 'UFF', departamento: d.departamento });
    db.projetos.push(novo);
    return novo;
  }

  /** Preenche início e fim das aulas pelo calendário letivo do projeto, quando o período tem calendário. */
  function ligarCalendario(form) {
    const per = form.querySelector('[name=periodo]'), sel = form.querySelector('#sel-projeto');
    const ini = form.querySelector('[name=inicio]'), fim = form.querySelector('[name=fim]'), aviso = form.querySelector('#aviso-cal');
    if (!per || !ini || !fim) return;
    let preenchido = false;
    const tentar = () => {
      const p = sel && projeto(sel.value), k = CC.chavePeriodo(per.value);
      const c = p && k ? p.calendario[k] : null;
      if (aviso) aviso.textContent = c ? `Calendário letivo ${k}: ${resumoCalendario(c)}. Os dias sem aula entram no cronograma como "Sem aula".` : '';
      if (!c) return;
      if ((!ini.value || preenchido) && c.inicio) { ini.value = c.inicio; preenchido = true; }
      if ((!fim.value || preenchido) && c.fim) fim.value = c.fim;
    };
    per.addEventListener('change', tentar);
    if (sel) sel.addEventListener('change', tentar);
    tentar();
  }

  /* ---------- tela: projeto ---------- */

  function telaProjeto(p) {
    contexto = { projetoId: p.id, disciplinaId: null };
    setTabs(null);
    setTopo(p.nome, [p.instituicao, p.departamento].filter(Boolean).join(' · ') || 'Projeto', '#/', () => menuProjeto(p));
    const ds = CC.disciplinasDoProjeto(db, p).map(d => {
      const ts = CC.turmasDaDisciplina(db, d).sort((x, y) => ordemPeriodo(x).localeCompare(ordemPeriodo(y)));
      return { d, ts, ativas: ts.filter(t => !t.arquivada).length, ultimo: ts.length ? ordemPeriodo(ts[ts.length - 1]) : '' };
    }).sort((x, y) => (y.ativas > 0) - (x.ativas > 0) || y.ultimo.localeCompare(x.ultimo) || CC.norm(x.d.nome).localeCompare(CC.norm(y.d.nome)));
    app.innerHTML = `<a class="card turma-card" href="#/p/${p.id}/calendario"><b>Calendário letivo</b><div class="muted small">${esc(resumoCalendarioAtual(p))}</div></a>
      ${ds.length > 6 ? `<div class="card"><input type="search" id="busca-disc" placeholder="Buscar disciplina (nome, código, sigla)" style="width:100%"></div>` : ''}
      <h3 class="secao">Disciplinas</h3><div id="lista-disc"></div>
      <button class="fab" id="imp">+ Importar planilha</button>`;
    const desenhar = () => {
      const b = $('#busca-disc'), q = CC.norm(b ? b.value : '');
      const lista = ds.filter(x => !q || [x.d.nome, x.d.codigo, x.d.sigla, x.d.pasta].some(v => CC.norm(v).includes(q)));
      $('#lista-disc').innerHTML = lista.length ? lista.map(({ d, ts, ativas }) => {
        const pers = ts.map(t => CC.periodoCurto(t.periodo)).filter(Boolean);
        const faixa = pers.length ? (pers[0] === pers[pers.length - 1] ? pers[0] : pers[0] + ' a ' + pers[pers.length - 1]) : '';
        return `<a class="card turma-card" href="#/d/${d.id}"><div><span class="codigo">${esc(d.codigo || d.departamento || '')}</span> <span class="muted">${esc(d.sigla || '')}</span>${d.nivel !== 'grad' ? ` <span class="tag cat">${esc(CC.NIVEIS[d.nivel] || d.nivel)}</span>` : ''}</div>
          <h2>${esc(d.nome || d.codigo || '?')}</h2>
          <div class="muted small">${ts.length} turma(s)${faixa ? ' · ' + esc(faixa) : ''}${ativas ? ` · <b>${ativas} ativa(s)</b>` : ''}</div></a>`;
      }).join('') : `<div class="card empty">${ds.length ? 'Nenhuma disciplina com esse nome.' : 'Nenhuma disciplina ainda. Importe uma planilha ou a pasta do projeto (menu ⋮).'}</div>`;
    };
    const b = $('#busca-disc'); if (b) b.addEventListener('input', desenhar);
    desenhar();
    $('#imp').onclick = importarNovaTurma;
  }

  function menuProjeto(p) {
    dialogo(`<h2>${esc(p.nome)}</h2><ul class="menu-list">
      <li><button value="editar">Editar projeto (instituição, regras)</button></li>
      <li><button value="cal">Calendário letivo</button></li>
      <li class="sep"></li>
      <li><button value="pasta">Importar a pasta do projeto (todas as planilhas)</button></li>
      <li><button value="importar">Importar planilha (nova turma)</button></li>
      <li><button value="vazia">Criar turma vazia</button></li>
      ${Pasta.suportada ? '<li><button value="gravar">Pasta onde salvar as planilhas do projeto</button></li>' : ''}
      <li class="sep"></li>
      <li><button value="excluir" style="color:var(--danger)">Excluir projeto</button></li></ul>`).then(r => {
      if (r.acao === 'editar') editarProjeto(p);
      if (r.acao === 'cal') go('#/p/' + p.id + '/calendario');
      if (r.acao === 'pasta') importarPasta(p);
      if (r.acao === 'importar') importarNovaTurma();
      if (r.acao === 'vazia') criarTurmaVazia();
      if (r.acao === 'gravar') configurarPasta(null, p);
      if (r.acao === 'excluir') excluirProjeto(p);
    });
  }

  async function editarProjeto(p) {
    const novo = !p;
    const c = Object.assign({}, CC.DEFAULT_CONFIG, p ? p.config : {});
    const ativas = p ? turmasDoProjeto(p).filter(t => !t.arquivada).length : 0;
    const r = await dialogo(`<h2>${novo ? 'Novo projeto' : 'Projeto'}</h2><div class="stack">
      <label class="field">Nome<input type="text" name="nome" value="${esc(p ? p.nome : '')}" placeholder="ex.: UFF · Ciência da Computação"></label>
      <div class="row nowrap"><label class="field grow">Instituição<input type="text" name="instituicao" value="${esc(p ? p.instituicao : 'UFF')}"></label>
      <label class="field grow">Departamento / unidade<input type="text" name="departamento" value="${esc(p ? p.departamento : '')}" placeholder="opcional"></label></div>
      <p class="muted small" style="margin-top:-6px">Na UFF, o curso e a forma de ingresso saem da matrícula.</p>
      <fieldset class="grupo"><legend>Regras das turmas (padrão do projeto)</legend><div class="stack">
      <div class="row nowrap">
      <label class="field grow">Frequência mínima (%)<input type="number" min="0" max="100" name="freqMin" value="${c.freqMin}"></label>
      <label class="field grow">Atraso vale (faltas)<input type="number" step="0.05" min="0" max="1" name="pesoAtraso" value="${c.pesoAtraso}"></label></div>
      <div class="row nowrap">
      <label class="field grow">Média mínima<input type="number" step="0.1" min="0" max="10" name="mediaMin" value="${c.mediaMin}"></label>
      <label class="field grow">Faz VS a partir de<input type="number" step="0.1" min="0" max="10" name="mediaVS" value="${c.mediaVS}"></label>
      <label class="field grow">Média mínima na pós<input type="number" step="0.1" min="0" max="10" name="mediaMinPos" value="${c.mediaMinPos == null ? '' : c.mediaMinPos}" placeholder="igual"></label></div>
      ${ativas ? `<label class="checks"><label><input type="checkbox" name="aplicar"> aplicar também às ${ativas} turma(s) não arquivada(s)</label></label>` : ''}
      <p class="muted small">As turmas novas do projeto começam com estas regras.</p>
      </div></fieldset></div>
      <div class="acoes"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">${novo ? 'Criar' : 'Salvar'}</button></div>`);
    if (r.acao !== 'ok') return null;
    const d = r.dados;
    if (novo) { p = CC.novoProjeto({ nome: d.nome, instituicao: d.instituicao, departamento: d.departamento }); db.projetos.push(p); }
    else {
      p.nome = String(d.nome || '').trim() || p.nome;
      p.instituicao = String(d.instituicao || '').trim();
      p.departamento = String(d.departamento || '').trim();
    }
    const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(x) ? null : x; };
    ['freqMin', 'pesoAtraso', 'mediaMin', 'mediaVS'].forEach(k => { const v = num(d[k]); if (v != null) p.config[k] = v; });
    p.config.mediaMinPos = num(d.mediaMinPos);
    CC.disciplinasDoProjeto(db, p).forEach(x => CC.sincronizarDisciplina(db, x));   // instituição nas turmas
    if (d.aplicar) turmasDoProjeto(p).filter(t => !t.arquivada).forEach(t => herdarRegras(t, p));
    db.projetoPadrao = p.id;
    salvar();
    if (novo) go('#/p/' + p.id); else render();
    return p;
  }

  async function excluirProjeto(p) {
    const n = turmasDoProjeto(p).length;
    if (n) {
      return dialogo(`<h2>Excluir projeto</h2><p>O projeto tem ${n} turma(s). Exclua as turmas ou mude o projeto delas (Configurações da turma → Projeto) antes.</p>
        <div class="acoes"><button class="btn primary" value="">Fechar</button></div>`);
    }
    if (!await confirmar('Excluir projeto', `Apagar o projeto <b>${esc(p.nome)}</b> e o calendário dele?`, 'Excluir', true)) return;
    db.projetos = db.projetos.filter(x => x !== p);
    db.disciplinas = db.disciplinas.filter(d => d.projetoId !== p.id);
    if (db.projetoPadrao === p.id) delete db.projetoPadrao;
    Pasta.esquecer('p:' + p.id).catch(() => {});
    salvar(); go('#/');
  }

  /* ---------- tela: disciplina ---------- */

  /** Resultado de uma turma (para a lista da disciplina). */
  function resultadoTurma(t) {
    const al = t.alunos.filter(a => a.ativo);
    const dadas = t.aulas.filter(a => CC.aulaRealizada(t, a)).length;
    if (!t.arquivada || !t.avaliacoes.length) return `${al.length} aluno(s) · ${dadas} aula(s) com chamada`;
    let ap = 0, rep = 0;
    al.forEach(a => {
      const s = CC.statsAluno(t, a);
      if (CC.reprovadoPorFalta(t, s.faltas) || s.sitNota.cod === 'BAIXA') rep++;
      else if (s.sitNota.cod === 'OK') ap++;
    });
    return `${al.length} aluno(s) · ${ap} aprovado(s) · ${rep} reprovado(s)`;
  }

  function telaDisciplina(d) {
    const p = projeto(d.projetoId);
    contexto = { projetoId: d.projetoId, disciplinaId: d.id };
    setTabs(null);
    setTopo([d.codigo || d.departamento, d.sigla].filter(Boolean).join(' · ') || d.nome, d.nome, p ? '#/p/' + p.id : '#/', () => menuDisciplina(d));
    const ts = CC.turmasDaDisciplina(db, d).sort((x, y) => ordemPeriodo(y).localeCompare(ordemPeriodo(x)) || String(x.turma).localeCompare(String(y.turma)));
    const c = d.config || {};
    const info = [c.cargaHoraria ? c.cargaHoraria + ' h' : '', c.horasAula ? c.horasAula + ' h por aula' : '', (c.categorias || []).length ? 'aulas: ' + c.categorias.join(', ') : ''].filter(Boolean);
    let h = `<div class="card"><div class="row nowrap"><div class="grow">
      <div class="small">${esc(CC.NIVEIS[d.nivel] || 'Graduação')}${d.semAvulsos ? ' · não aceita alunos avulsos' : ''}</div>
      ${info.length ? `<div class="muted small">${esc(info.join(' · '))}</div>` : ''}
      <div class="muted small">${esc(p ? p.nome : '')}${d.pasta ? ' · pasta ' + esc(d.pasta) : ''}</div></div>
      <button class="btn small" id="editar-disc">Editar</button></div></div>
      <h3 class="secao">Turmas (${ts.length})</h3>`;
    h += ts.map(t => `<a class="card turma-card ${t.arquivada ? 'arquivada' : ''}" href="#/t/${t.id}/chamada">
      <div><span class="codigo">${esc(CC.periodoCurto(t.periodo) || '?')}</span> <span class="muted">${esc(t.turma || '')}</span>${t.arquivada ? '' : ' <span class="tag OK">ativa</span>'}</div>
      ${t.tema ? `<div class="small">${esc(t.tema)}</div>` : ''}
      <div class="muted small">${resultadoTurma(t)}</div></a>`).join('');
    h += `<button class="fab" id="nova">+ Nova turma</button>`;
    app.innerHTML = h;
    $('#editar-disc').onclick = () => editarDisciplina(d);
    $('#nova').onclick = () => criarTurmaVazia(d);
  }

  function menuDisciplina(d) {
    dialogo(`<h2>${esc(d.nome)}</h2><ul class="menu-list">
      <li><button value="editar">Editar disciplina</button></li>
      <li><button value="nova">Nova turma desta disciplina</button></li>
      <li><button value="importar">Importar planilha (nova turma)</button></li></ul>`).then(r => {
      if (r.acao === 'editar') editarDisciplina(d);
      if (r.acao === 'nova') criarTurmaVazia(d);
      if (r.acao === 'importar') importarNovaTurma();
    });
  }

  async function editarDisciplina(d) {
    const c = d.config || {};
    const ativas = CC.turmasDaDisciplina(db, d).filter(t => !t.arquivada).length;
    const r = await dialogo(`<h2>Disciplina</h2><div class="stack">
      <label class="field">Nome<input type="text" name="nome" value="${esc(d.nome)}" required></label>
      <div class="row nowrap"><label class="field grow">Código<input type="text" name="codigo" value="${esc(d.codigo)}"></label>
      <label class="field grow">Sigla (nomes de arquivo)<input type="text" name="sigla" value="${esc(d.sigla)}" placeholder="${esc(CC.siglaDisciplina(d.nome))}"></label></div>
      <label class="field">Nível<select name="nivel">${Object.keys(CC.NIVEIS).map(k => `<option value="${k}" ${d.nivel === k ? 'selected' : ''}>${CC.NIVEIS[k]}</option>`).join('')}</select></label>
      <div class="checks"><label><input type="checkbox" name="semAvulsos" ${d.semAvulsos ? 'checked' : ''}> não aceita alunos avulsos (ex.: "Tópicos especiais…")</label></div>
      <p class="muted small" style="margin-top:-4px">Na pós não há VS e vale a média mínima da pós (regras do projeto).</p>
      ${db.projetos.length > 1 ? `<label class="field">Projeto<select name="projetoId">${db.projetos.map(p => `<option value="${p.id}" ${p.id === d.projetoId ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>` : ''}
      <fieldset class="grupo"><legend>Padrão das turmas novas</legend><div class="stack">
      <div class="row nowrap"><label class="field grow">Carga horária (h)<input type="number" min="0" name="cargaHoraria" list="cargas" value="${c.cargaHoraria || ''}"></label>
      <label class="field grow">Horas por aula<input type="number" min="0" step="0.5" name="horasAula" value="${c.horasAula || ''}"></label></div>
      <datalist id="cargas"><option value="60"><option value="64"><option value="68"></datalist>
      <label class="field">Tipos de aula (separados por vírgula)<input type="text" name="categorias" value="${esc((c.categorias || []).join(', '))}" placeholder="ex.: Teórica, Laboratório"></label>
      ${ativas ? `<label class="checks"><label><input type="checkbox" name="aplicar"> aplicar carga horária e tipos de aula às ${ativas} turma(s) não arquivada(s)</label></label>` : ''}
      </div></fieldset>
      <p class="muted small">Nome, código, sigla e nível valem para todas as turmas da disciplina.</p></div>
      <div class="acoes"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao !== 'ok') return;
    const x = r.dados;
    d.nome = String(x.nome || '').trim() || d.nome;
    d.codigo = String(x.codigo || '').trim();
    d.sigla = String(x.sigla || '').trim();
    if (x.nivel && x.nivel !== d.nivel) d.nivelFixo = true;
    d.nivel = x.nivel || 'grad';
    d.semAvulsos = !!x.semAvulsos;
    if (x.projetoId && projeto(x.projetoId)) d.projetoId = x.projetoId;
    const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) || n <= 0 ? null : n; };
    d.config = {};
    if (num(x.cargaHoraria)) d.config.cargaHoraria = num(x.cargaHoraria);
    if (num(x.horasAula)) d.config.horasAula = num(x.horasAula);
    const cats = lerCategorias(x.categorias);
    if (cats.length) d.config.categorias = cats;
    CC.sincronizarDisciplina(db, d);
    if (x.aplicar) CC.turmasDaDisciplina(db, d).filter(t => !t.arquivada).forEach(t => {
      ['cargaHoraria', 'horasAula'].forEach(k => { if (d.config[k]) t.config[k] = d.config[k]; });
      if (cats.length) { t.config.categorias = cats.slice(); CC.aplicarCategorias(t); }
    });
    salvar(); render();
  }

  /* ---------- importar a pasta do projeto ---------- */

  const EXTS_PLANILHA = ['.xls', '.xlsx', '.ods'];

  /** Seletor de pasta do sistema (onde não há showDirectoryPicker): devolve os arquivos com o caminho relativo. */
  function escolherPastaDoSistema() {
    const input = $('#file-input');
    input.value = '';
    input.accept = '';
    input.multiple = true;
    input.webkitdirectory = true;
    return new Promise(resolve => {
      input.onchange = () => { const fs = Array.from(input.files); input.webkitdirectory = false; resolve(fs); };
      input.click();
    });
  }

  /** Planilha que parece de uma turma: tem período (na lista ou na aba Configuração) e não é um resumo
   *  (ex.: UFF-aulas-resumo.xlsx, com as pessoas de todas as turmas). As outras vêm desmarcadas. */
  function pareceTurma(i) {
    const per = i.p.meta.periodo || (i.p.configuracao && i.p.configuracao.meta.periodo);
    return !!per && !/resumo/i.test(i.f.name);
  }

  /** Planilhas de um .zip da pasta do projeto, com o caminho (as subpastas viram disciplinas). */
  async function entradasDoZip(z) {
    if (semXLSX()) throw new Error('biblioteca de planilhas indisponível');
    const cfb = XLSX.CFB.read(new Uint8Array(await z.arrayBuffer()), { type: 'array' });
    let itens = cfb.FullPaths.map((p, i) => ({ partes: p.split('/').filter(Boolean).slice(1), f: cfb.FileIndex[i] }))
      .filter(x => x.f.type === 2 && x.f.content && x.partes.length && !x.partes.some(n => n.startsWith('.') || n.startsWith('~$') || n.startsWith('__MACOSX'))
        && EXTS_PLANILHA.some(e => x.partes[x.partes.length - 1].toLowerCase().endsWith(e)));
    // Se tudo está dentro de uma pasta só (o .zip de "LK-UFF-aulas"), ela é a pasta do projeto.
    let nomePasta = z.name.replace(/\.zip$/i, '').replace(/-\d{8}T\d{6}Z-\d+-\d+$/, '');   // nome do .zip do Google Drive
    const topo = new Set(itens.map(x => x.partes[0]));
    if (topo.size === 1 && itens.every(x => x.partes.length > 1)) { nomePasta = itens[0].partes[0]; itens = itens.map(x => ({ partes: x.partes.slice(1), f: x.f })); }
    const entradas = itens.map(x => ({ file: new File([x.f.content], x.partes[x.partes.length - 1]), caminho: x.partes }))
      .sort((a, b) => a.caminho.join('/').localeCompare(b.caminho.join('/')));
    return { nomePasta, entradas };
  }

  /** Cria uma turma para cada planilha lida e põe no projeto/disciplina. itens: [{ f, p, pasta? }]. Devolve as disciplinas novas. */
  function criarTurmasDePlanilhas(itens, proj, arquivar) {
    const atual = periodoAtualNum();
    const novas = new Set();
    itens.forEach(i => {
      const cfg = i.p.configuracao || {};
      const t = CC.turmaDePlanilha(i.p, { instituicao: proj ? proj.instituicao : (db.instituicao || 'UFF'), dataLista: dataDoArquivo(i.f) });
      if (arquivar && t.periodo && String(t.periodo) < atual) t.arquivada = CC.todayISO();
      db.turmas.push(t);
      const n0 = db.disciplinas.length;
      const r = CC.vincularTurma(db, t, {
        projetoId: proj && proj.id, pasta: i.pasta ? i.pasta.nome : '', sigla: (i.pasta && i.pasta.sigla) || cfg.sigla,
        departamento: (i.pasta && i.pasta.departamento) || cfg.departamento, nivel: cfg.nivel
      });
      if (db.disciplinas.length > n0) novas.add(r.d);
    });
    novas.forEach(d => CC.ajustarDisciplina(db, d));
    return novas;
  }

  /**
   * Importa todas as planilhas de uma pasta (e subpastas): cada subpasta no padrão "UFF-código-sigla"
   * vira uma disciplina, cada planilha uma turma. teste = { nomePasta, entradas, handle } (para depurar).
   */
  async function importarPasta(proj, teste) {
    let nomePasta = '', entradas = [], handle = null;
    if (teste) ({ nomePasta, entradas, handle } = teste);
    else if (Pasta.suportada) {
      const inicio = Date.now();
      try { handle = await window.showDirectoryPicker({ id: 'chamada-projeto', mode: 'read', startIn: 'documents' }); }
      catch (e) { seletorFalhou(e, inicio, 'a lista de pastas'); return; }
      nomePasta = handle.name;
      toast('Procurando planilhas em ' + nomePasta + '…');
      try { entradas = await Pasta.arquivos(handle, EXTS_PLANILHA, 3); } catch (e) { return toast('Não consegui ler a pasta: ' + e.message); }
    } else {
      // Sem seletor de pasta (celular, DuckDuckGo, Firefox): .zip da pasta, a pasta pelo seletor de arquivos
      // (só no computador) ou várias planilhas soltas.
      const celular = /Android|iPhone|iPad/i.test(navigator.userAgent);
      const r = await dialogo(`<h2>Importar a pasta de um projeto</h2>
        <p>${esc(nomeNavegador())} não deixa o app abrir uma pasta${celular ? ' no celular' : ''}. Escolha como trazer as planilhas:</p>
        <div class="stack"><button class="btn primary block" value="zip">Pasta compactada (.zip)</button>
        ${celular ? '' : '<button class="btn block" value="pasta">Escolher a pasta</button>'}
        <button class="btn block" value="varias">Várias planilhas (sem as subpastas)</button></div>
        <p class="muted small">O .zip guarda as subpastas, que viram as disciplinas. No Google Drive pelo navegador, "Fazer download" de uma pasta
        entrega o .zip (no computador, ou no celular com "Site para computador"). Outro caminho: importar a pasta no computador
        (Chrome ou Edge), salvar um backup e restaurá-lo aqui.</p>
        <div class="acoes"><button class="btn" value="">Cancelar</button></div>`);
      if (!r.acao) return;
      if (r.acao === 'zip') {
        const z = await escolherDoSistema('.zip,application/zip', false);
        if (!z) return;
        try { ({ nomePasta, entradas } = await entradasDoZip(z)); } catch (e) { return toast('Não consegui abrir o .zip: ' + e.message); }
      } else {
        const files = r.acao === 'pasta' ? await escolherPastaDoSistema() : await escolherDoSistema('.xls,.xlsx,.ods', true);
        if (!files || !files.length) return toast(r.acao === 'pasta' ? 'O navegador não entregou os arquivos da pasta. Use o .zip.' : 'Nenhum arquivo escolhido.');
        nomePasta = (files[0].webkitRelativePath || '').split('/')[0] || 'planilhas';
        entradas = files.filter(f => EXTS_PLANILHA.some(x => f.name.toLowerCase().endsWith(x)) && !f.name.startsWith('~$'))
          .map(f => f.webkitRelativePath ? { file: f, caminho: f.webkitRelativePath.split('/').slice(1) }
            : { file: f, caminho: [f.name], semPasta: true });   // vieram só arquivos, sem as pastas
      }
    }
    if (!entradas.length) return toast('Nenhuma planilha (.xls, .xlsx, .ods) nessa pasta.');
    if (semXLSX()) return;

    dialogo(`<h2>Lendo planilhas…</h2><progress id="prog-pasta" max="${entradas.length}" value="0" style="width:100%"></progress>
      <p class="muted small" id="prog-txt"></p>`);
    const itens = [];
    for (let k = 0; k < entradas.length; k++) {
      const e = entradas[k];
      const pg = $('#prog-pasta');
      if (pg) { pg.value = k; $('#prog-txt').textContent = `${k + 1} de ${entradas.length}: ${e.caminho.join('/')}`; }
      let p = null;
      try { p = await lerPlanilha(e.file); } catch (err) { /* ilegível ou com senha */ }
      const dir = e.caminho.length > 1 ? e.caminho[e.caminho.length - 2] : '';
      const info = dir ? CC.lerNomePasta(dir) : null;
      itens.push({ f: e.file, caminho: e.caminho.join('/'), p, raiz: e.caminho.length === 1 && !e.semPasta, pasta: info ? Object.assign({ nome: dir }, info) : null });
      await new Promise(ok => setTimeout(ok, 0));   // deixa a barra andar
    }
    const chaveDe = (cod, disc, tur, per, tema) => [cod || CC.norm(disc), tur, per, tema || ''].join('|');
    const existentes = new Set(db.turmas.map(t => chaveDe(t.codigo, t.disciplina, t.turma, t.periodo, t.tema)));
    const vistas = new Set();
    itens.forEach(i => {
      if (!i.p) return;
      const m = i.p.meta, cfg = i.p.configuracao || {};
      i.chave = chaveDe(m.codigo, m.disciplina, m.turma, m.periodo, cfg.tema);
      i.existe = existentes.has(i.chave) || vistas.has(i.chave);
      vistas.add(i.chave);
      i.ok = i.p.alunos.length > 0 && !i.existe;
      i.marcar = i.ok && !i.raiz && pareceTurma(i);
    });
    const lin = i => !i.p ? 'não abriu (com senha ou corrompida?)' : !i.p.alunos.length ? 'sem alunos reconhecidos' : i.existe ? 'turma já existe'
      : !pareceTurma(i) ? `não parece uma turma (sem período ou é um resumo) · ${i.p.alunos.length} nomes`
      : `${[CC.periodoCurto(i.p.meta.periodo), i.p.meta.turma].filter(Boolean).join(' · ')} · ${i.p.alunos.length} alunos`;
    const inst = maisComum(itens.map(i => i.pasta && i.pasta.instituicao).filter(Boolean)) || 'UFF';
    const deptos = Array.from(new Set(itens.map(i => i.pasta && i.pasta.departamento).filter(Boolean)));
    const projSel = proj ? proj.id : ((db.projetos.find(p => CC.norm(p.nome) === CC.norm(nomePasta)) || {}).id || 'novo');
    const nPastas = new Set(itens.map(i => i.pasta && i.pasta.nome).filter(Boolean)).size;
    const marcadas = itens.filter(i => i.marcar).length;
    const r = await dialogo(`<h2>Importar “${esc(nomePasta)}”</h2>
      <p class="muted small">${itens.length} planilha(s)${nPastas ? ` em ${nPastas} pasta(s) de disciplina` : ''}. Cada pasta no padrão <b>UFF-código-sigla</b> vira uma disciplina; cada planilha, uma turma.</p>
      <label class="field">Projeto<select name="projetoId" id="sel-projeto">${db.projetos.map(p => `<option value="${p.id}" ${p.id === projSel ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}
        <option value="novo" ${projSel === 'novo' ? 'selected' : ''}>Novo projeto: ${esc(nomePasta)}</option></select></label>
      <div class="row nowrap" id="novo-projeto"><label class="field grow">Instituição<input type="text" name="instituicao" value="${esc(inst)}"></label>
      <label class="field grow">Departamento<input type="text" name="departamento" value="${esc(deptos.length === 1 ? deptos[0] : '')}" placeholder="${esc(deptos.join(', ') || 'opcional')}"></label></div>
      <input type="hidden" name="projNome" value="${esc(nomePasta)}">
      <div class="checks"><label><input type="checkbox" name="arquivar" checked> arquivar as turmas de períodos anteriores ao atual</label>
      ${handle && Pasta.suportada ? '<label><input type="checkbox" name="guardar" checked> salvar nesta pasta as planilhas exportadas das turmas do projeto (cada uma na pasta da sua disciplina)</label>' : ''}</div>
      <details class="small"><summary><b id="conta-sel">${marcadas}</b> de ${itens.length} planilha(s) selecionada(s)</summary>
      <div class="scroll checks">${itens.map((i, k) => `<label><input type="checkbox" name="arq" value="${k}" ${i.marcar ? 'checked' : ''} ${i.ok ? '' : 'disabled'}> ${esc(i.caminho)} <span class="muted">— ${esc(lin(i))}</span></label>`).join('')}</div></details>
      <p class="muted small">Planilhas soltas na raiz da pasta e as que não parecem de uma turma (sem período, ou um resumo) vêm desmarcadas.</p>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Importar</button></div>`,
    form => {
      ligarProjeto(form);
      form.addEventListener('change', () => { form.querySelector('#conta-sel').textContent = form.querySelectorAll('[name=arq]:checked').length; });
    });
    if (r.acao !== 'ok') return;
    const sel = [].concat(r.dados.arq || []).map(Number).map(k => itens[k]).filter(i => i && i.ok);
    if (!sel.length) return toast('Nenhuma planilha selecionada.');
    const p = projetoDoForm(r.dados);
    const novas = criarTurmasDePlanilhas(sel, p, !!r.dados.arquivar);
    if (handle && r.dados.guardar) { try { await Pasta.guardar('p:' + p.id, handle); } catch (e) { /* fica sem a pasta */ } }
    db.projetoPadrao = p.id;
    salvar(); go('#/p/' + p.id);
    toast(`${sel.length} turma(s) importada(s) · ${novas.size} disciplina(s) nova(s)`);
  }

  /* ---------- calendário letivo ---------- */

  function resumoCalendario(c) {
    const sa = (c.eventos || []).filter(e => e.semAula).length, av = (c.eventos || []).length - sa;
    return [c.inicio && c.fim ? CC.fmtDate(c.inicio) + ' a ' + CC.fmtDate(c.fim) : c.inicio ? 'início ' + CC.fmtDate(c.inicio) : 'sem início/fim',
      sa + ' dia(s) ou intervalo(s) sem aula', av ? av + ' aviso(s)' : ''].filter(Boolean).join(' · ');
  }

  function resumoCalendarioAtual(p) {
    const ks = Object.keys(p.calendario || {}).sort();
    if (!ks.length) return 'Não preenchido: leia o PDF da universidade, digite ou deduza dos cronogramas das turmas.';
    const hoje = CC.todayISO();
    const k = ks.find(x => { const c = p.calendario[x]; return c.inicio && c.fim && hoje >= c.inicio && hoje <= c.fim; }) ||
      (ks.includes(periodoDeHoje()) ? periodoDeHoje() : ks[ks.length - 1]);
    return k + ': ' + resumoCalendario(p.calendario[k]) + (ks.length > 1 ? ` · ${ks.length} períodos` : '');
  }

  /** Aulas ainda sem chamada que caem em dia sem aula do calendário. */
  function feriadosPendentes(t, c) {
    return t.aulas.filter(a => a.tipo !== 'sem-aula' && !CC.aulaRealizada(t, a) && CC.semAulaEm(c, a.data)).length;
  }

  const turmasDoPeriodo = (p, k) => turmasDoProjeto(p).filter(t => CC.chavePeriodo(t.periodo) === k);

  function aplicarCalendarioPeriodo(p, k) {
    const c = p.calendario[k];
    let n = 0;
    turmasDoPeriodo(p, k).forEach(t => {
      n += CC.aplicarCalendario(t, c);
      if (!t.config.inicio && c.inicio) t.config.inicio = c.inicio;
      if (!t.config.fim && c.fim) t.config.fim = c.fim;
    });
    salvar(); render();
    toast(n + ' aula(s) marcada(s) como "Sem aula"');
  }

  async function oferecerAplicar(p, k) {
    const c = p.calendario[k];
    const n = turmasDoPeriodo(p, k).reduce((s, t) => s + feriadosPendentes(t, c), 0);
    if (!n) return;
    if (await confirmar('Aplicar às turmas', `${n} aula(s) ainda sem chamada caem em dias sem aula nas turmas de ${esc(k)}. Marcar como "Sem aula"?`, 'Marcar')) aplicarCalendarioPeriodo(p, k);
  }

  function telaCalendario(p) {
    contexto = { projetoId: p.id, disciplinaId: null };
    setTabs(null);
    setTopo('Calendário letivo', p.nome, '#/p/' + p.id, () => menuProjeto(p));
    const ks = Object.keys(p.calendario).sort().reverse();
    let h = `<div class="card"><p class="small" style="margin-top:0">Início e fim das aulas, feriados e recessos de cada período. Ao gerar o cronograma de uma turma, os dias sem aula entram como "Sem aula".</p>
      <div class="row"><button class="btn small" id="cal-pdf">Ler PDF do calendário…</button><button class="btn small" id="cal-deduzir">Deduzir dos cronogramas</button>
      <button class="btn small primary" id="cal-novo">+ Período</button></div></div>`;
    h += ks.length ? ks.map(k => {
      const c = p.calendario[k], ts = turmasDoPeriodo(p, k);
      const pend = ts.reduce((n, t) => n + feriadosPendentes(t, c), 0);
      const ev = CC.ordenarEventos(c.eventos);
      return `<div class="card"><div class="row nowrap"><div class="grow"><h3>${esc(k)}</h3>
        <div class="muted small">${esc(resumoCalendario(c))}${ts.length ? ` · ${ts.length} turma(s)` : ''}</div></div>
        <button class="btn small" data-editar="${esc(k)}">Editar</button></div>
        ${ev.length ? `<ul class="small eventos">${ev.map(e => `<li class="${e.semAula ? '' : 'muted'}">${esc(CC.fmtDate(e.data))}${e.ate ? ' a ' + esc(CC.fmtDate(e.ate)) : ''} — ${esc(e.descricao)}${e.semAula ? '' : ' (aviso)'}</li>`).join('')}</ul>` : ''}
        ${pend ? `<button class="btn small" data-aplicar="${esc(k)}">Marcar ${pend} aula(s) como "Sem aula" nas turmas</button>` : ''}</div>`;
    }).join('') : '<div class="card empty">Nenhum período ainda.</div>';
    app.innerHTML = h;
    $('#cal-pdf').onclick = () => lerCalendarioPDF(p);
    $('#cal-deduzir').onclick = () => deduzirCalendario(p);
    $('#cal-novo').onclick = () => editarPeriodoCal(p, null);
    app.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => editarPeriodoCal(p, b.dataset.editar));
    app.querySelectorAll('[data-aplicar]').forEach(b => b.onclick = () => aplicarCalendarioPeriodo(p, b.dataset.aplicar));
  }

  /** Feriados locais usados pelo botão "+ Feriados": RJ, Niterói e o Dia do Professor (feriado escolar na UFF). */
  function locaisDe(p) {
    const uff = CC.ehUFF(p);
    return Object.assign({ rj: uff, niteroi: uff, professor: uff }, p.feriadosLocais);
  }

  async function editarPeriodoCal(p, k) {
    const c = (k && p.calendario[k]) || { inicio: '', fim: '', eventos: [] };
    const loc = locaisDe(p);
    const r = await dialogo(`<h2>${k ? 'Período ' + esc(k) : 'Novo período'}</h2><div class="stack">
      <label class="field">Período<input type="text" name="periodo" value="${esc(k || periodoDeHoje())}" placeholder="ex.: 2026-2" required></label>
      <div class="row nowrap"><label class="field grow">Início das aulas<input type="date" name="inicio" value="${c.inicio || ''}"></label>
      <label class="field grow">Fim<input type="date" name="fim" value="${c.fim || ''}"></label></div>
      <label class="field">Dias sem aula e avisos (um por linha)<textarea name="eventos" rows="10" style="font-family:monospace;font-size:14px" placeholder="07/09/2026 Independência do Brasil&#10;13/10/2026 a 17/10/2026 Semana acadêmica&#10;* 15/12/2026 Prazo para lançar as notas">${esc(CC.eventosParaTexto(c.eventos))}</textarea></label>
      <p class="muted small" style="margin-top:-6px">Formato: <b>dd/mm</b> ou <b>dd/mm a dd/mm</b> (ano opcional) e a descrição. Linha começando com <b>*</b> é só aviso: não cancela aula.
        "+ Feriados" põe a previsão; a lista oficial da UFF sai numa resolução no começo do ano (leia o PDF dela em "Ler PDF").</p>
      <div class="row"><button type="button" class="btn small" id="add-feriados">+ Feriados</button>
        <label class="small"><input type="checkbox" name="ferRJ" ${loc.rj ? 'checked' : ''}> do RJ</label>
        <label class="small"><input type="checkbox" name="ferNit" ${loc.niteroi ? 'checked' : ''}> de Niterói</label>
        <label class="small"><input type="checkbox" name="ferProf" ${loc.professor ? 'checked' : ''}> Dia do Professor (UFF)</label>
        <button type="button" class="btn small" id="add-turmas">+ Dos cronogramas</button></div>
      <p class="small" id="cal-msg"></p></div>
      <div class="acoes">${k ? '<button class="btn danger" value="excluir" formnovalidate>Excluir</button>' : ''}<button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`,
    form => {
      const ta = form.querySelector('[name=eventos]'), msg = form.querySelector('#cal-msg');
      const val = n => form.querySelector(`[name=${n}]`).value;
      const juntar = (novos, rot) => {
        const atuais = CC.textoParaEventos(ta.value, val('inicio')).eventos;
        const todos = CC.juntarEventos(atuais, novos);
        msg.textContent = `${todos.length - atuais.length} ${rot} acrescentado(s).`;
        ta.value = CC.eventosParaTexto(todos);
      };
      form.querySelector('#add-feriados').onclick = () => {
        if (!val('inicio') || !val('fim')) { msg.textContent = 'Preencha antes o início e o fim das aulas.'; return; }
        const marcado = n => form.querySelector(`[name=${n}]`).checked;
        juntar(CC.feriadosEntre(val('inicio'), val('fim'), { rj: marcado('ferRJ'), niteroi: marcado('ferNit'), professor: marcado('ferProf') }), 'feriado(s)');
      };
      form.querySelector('#add-turmas').onclick = () => {
        const kk = CC.chavePeriodo(val('periodo'));
        const d = CC.calendarioDasTurmas(turmasDoProjeto(p))[kk];
        if (!d) { msg.textContent = 'Nenhuma turma deste projeto tem cronograma em ' + (kk || 'esse período') + '.'; return; }
        if (!val('inicio')) form.querySelector('[name=inicio]').value = d.inicio;
        if (!val('fim')) form.querySelector('[name=fim]').value = d.fim;
        juntar(d.eventos, 'dia(s) sem aula');
      };
    });
    if (r.acao === 'excluir') {
      if (await confirmar('Excluir período', `Apagar o calendário de ${esc(k)}? As turmas não mudam.`, 'Excluir', true)) { delete p.calendario[k]; salvar(); render(); }
      return;
    }
    if (r.acao !== 'ok') return;
    const nk = CC.chavePeriodo(r.dados.periodo);
    if (!nk) return toast('Período inválido: use o formato 2026-2');
    p.feriadosLocais = { rj: !!r.dados.ferRJ, niteroi: !!r.dados.ferNit, professor: !!r.dados.ferProf };
    const lido = CC.textoParaEventos(r.dados.eventos, r.dados.inicio);
    if (lido.erros.length && !await confirmar('Linhas não entendidas', `Estas linhas serão ignoradas:<br>${lido.erros.map(esc).join('<br>')}`, 'Salvar assim')) return;
    if (k && k !== nk) delete p.calendario[k];
    p.calendario[nk] = { inicio: r.dados.inicio || '', fim: r.dados.fim || '', eventos: lido.eventos };
    salvar(); render();
    await oferecerAplicar(p, nk);
  }

  async function deduzirCalendario(p) {
    const d = CC.calendarioDasTurmas(turmasDoProjeto(p));
    const ks = Object.keys(d).sort();
    if (!ks.length) return toast('Nenhuma turma do projeto tem cronograma.');
    const ok = await confirmar('Deduzir dos cronogramas', `${ks.length} período(s) (${esc(ks[0])}${ks.length > 1 ? ' a ' + esc(ks[ks.length - 1]) : ''}).
      Início e fim = primeira e última aula das turmas; as aulas marcadas "Sem aula" viram dias sem aula. O que já está no calendário é mantido.`, 'Deduzir');
    if (!ok) return;
    let novos = 0;
    ks.forEach(k => {
      const atual = p.calendario[k];
      if (!atual) { p.calendario[k] = d[k]; novos++; return; }
      if (!atual.inicio) atual.inicio = d[k].inicio;
      if (!atual.fim) atual.fim = d[k].fim;
      atual.eventos = CC.juntarEventos(atual.eventos, d[k].eventos);
    });
    salvar(); render();
    toast(`${ks.length} período(s) deduzido(s), ${novos} novo(s). Confira as datas.`);
  }

  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  function carregarPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js'; s.crossOrigin = 'anonymous';
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = () => { s.remove(); erro(new Error('não consegui baixar o leitor de PDF (é preciso internet na primeira vez)')); };
      document.head.appendChild(s);
    });
  }

  /** Texto do PDF, uma string por linha (itens agrupados pela altura na página). */
  async function linhasDoPDF(file) {
    const lib = await carregarPdfJs();
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const linhas = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      const grupos = [];
      tc.items.forEach(it => {
        if (!it.str || !it.str.trim()) return;
        const y = it.transform[5];
        let gr = grupos.find(x => Math.abs(x.y - y) < 3);
        if (!gr) { gr = { y, itens: [] }; grupos.push(gr); }
        gr.itens.push({ x: it.transform[4], s: it.str });
      });
      grupos.sort((a, b) => b.y - a.y).forEach(gr => linhas.push(gr.itens.sort((a, b) => a.x - b.x).map(x => x.s).join(' ')));
    }
    return linhas;
  }

  async function lerCalendarioPDF(p, arquivo) {
    const file = arquivo || await escolherDoSistema('.pdf,application/pdf');
    if (!file) return;
    toast('Lendo o PDF…');
    let linhas;
    try { linhas = await linhasDoPDF(file); } catch (e) { return toast('Não consegui ler o PDF: ' + e.message); }
    const lido = CC.calendarioDoTexto(linhas);
    const loc = locaisDe(p);
    // Resolução de feriados e pontos facultativos (sai separada, no começo do ano): vai para os períodos do ano.
    const fer = CC.feriadosDoTexto(linhas, loc.niteroi ? 'Niterói' : (loc.municipio || ''));
    if (fer) {
      fer.eventos.forEach(e => {
        const k = Object.keys(lido).concat(Object.keys(p.calendario)).find(x => {
          const c = lido[x] || p.calendario[x];
          return c.inicio && c.fim && e.data >= c.inicio && e.data <= c.fim;
        });
        const chave = k || (CC.chavePeriodo(e.data.slice(0, 4) + '-' + (+e.data.slice(5, 7) <= 7 ? 1 : 2)));
        const c = lido[chave] || (lido[chave] = Object.assign({ inicio: '', fim: '' }, p.calendario[chave] ? { inicio: p.calendario[chave].inicio, fim: p.calendario[chave].fim } : {}, { eventos: [] }));
        if (c.inicio && c.fim && (e.data > c.fim || (e.ate || e.data) < c.inicio)) return;   // fora das aulas
        c.eventos.push(e);
      });
    }
    const ks = Object.keys(lido).sort();
    if (!ks.length) {
      return dialogo(`<h2>Calendário não reconhecido</h2><p>${linhas.join('').trim() ? 'Não encontrei nesse PDF as datas dos períodos letivos nem feriados.' : 'O PDF não tem texto (parece uma imagem escaneada).'}
        Preencha à mão em <b>+ Período</b>: início, fim e os feriados (o botão "+ Feriados" acrescenta os nacionais).</p>
        <div class="acoes"><button class="btn primary" value="">Fechar</button></div>`);
    }
    const r = await dialogo(`<h2>${fer ? 'Feriados lidos do PDF' : 'Calendário lido do PDF'}</h2>
      <p class="muted small">${esc(file.name)}. A leitura é automática: confira e corrija antes de salvar. Linha com * é só aviso (não cancela aula).
      ${fer ? `Feriados e pontos facultativos de ${fer.ano}${loc.niteroi ? ' (municipais: só os de Niterói)' : ''}, nos períodos em que caem.` : ''}</p>
      ${ks.map(k => { const c = lido[k]; return `<fieldset class="grupo"><legend><label><input type="checkbox" name="usar" value="${k}" checked> ${k}</label></legend><div class="stack">
        <div class="row nowrap"><label class="field grow">Início<input type="date" name="ini_${k}" value="${c.inicio}"></label><label class="field grow">Fim<input type="date" name="fim_${k}" value="${c.fim}"></label></div>
        <textarea name="ev_${k}" rows="6" style="font-family:monospace;font-size:13px">${esc(CC.eventosParaTexto(c.eventos))}</textarea></div></fieldset>`; }).join('')}
      ${fer ? '' : `<div class="checks"><label><input type="checkbox" name="feriados" checked> acrescentar a previsão dos feriados (nacionais${loc.rj ? ', do RJ' : ''}${loc.niteroi ? ', de Niterói' : ''}${loc.professor ? ', Dia do Professor' : ''}); a lista oficial da UFF sai numa resolução à parte</label></div>`}
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao !== 'ok') return;
    const usar = [].concat(r.dados.usar || []);
    usar.forEach(k => {
      const ini = r.dados['ini_' + k] || '', fim = r.dados['fim_' + k] || '';
      let ev = CC.textoParaEventos(r.dados['ev_' + k], ini).eventos;
      if (r.dados.feriados && ini && fim) ev = CC.juntarEventos(ev, CC.feriadosEntre(ini, fim, loc));
      const atual = p.calendario[k] || { inicio: '', fim: '', eventos: [] };
      p.calendario[k] = { inicio: ini || atual.inicio, fim: fim || atual.fim, eventos: CC.juntarEventos(atual.eventos, ev) };
    });
    salvar(); render();
    toast(usar.length + ' período(s) salvo(s) no calendário');
    for (const k of usar) await oferecerAplicar(p, k);
  }

  /* ---------- tela: turmas ---------- */

  function telaTurmas() {
    contexto = { projetoId: null, disciplinaId: null };
    setTabs(null);
    setTopo('Chamada', 'Suas turmas', null, menuGeral);
    if (aguardandoIDB) { app.innerHTML = '<div class="card empty">Carregando…</div>'; return; }
    if (!db.turmas.length) {
      app.innerHTML = `<div class="card empty">
        <p><strong>Nenhuma turma ainda.</strong></p>
        <p>Importe a lista de alunos exportada do sistema (.xls ou .xlsx) — ou uma planilha de chamada antiga — para criar a primeira turma.</p>
        <div class="stack"><button class="btn primary block" id="imp">Importar planilha</button>
        <button class="btn block" id="pasta">Importar a pasta de um projeto (várias turmas)</button>
        <button class="btn block" id="nova">Criar turma vazia</button>
        <button class="btn block" id="restaurar">Restaurar backup</button></div></div>`;
    } else {
      const cartao = t => {
        const ativos = t.alunos.filter(a => a.ativo).length;
        const dadas = t.aulas.filter(a => CC.aulaRealizada(t, a)).length;
        return `<a class="card turma-card ${t.arquivada ? 'arquivada' : ''}" href="#/t/${t.id}/chamada">
          <div><span class="codigo">${esc([t.codigo, t.turma].filter(Boolean).join(' '))}</span> <span class="muted">${esc(t.periodo)}</span></div>
          <h2>${esc(CC.disciplinaTema(t))}</h2>
          <div class="muted small">${ativos} alunos · ${dadas} de ${CC.aulasPrevistas(t)} aulas com chamada${t.arquivada ? ' · arquivada em ' + CC.fmtDate(t.arquivada) : ''}</div></a>`;
      };
      const ativas = db.turmas.filter(t => !t.arquivada), arquivadas = db.turmas.filter(t => t.arquivada);
      app.innerHTML = (ativas.length ? ativas.map(cartao).join('') : '<div class="card empty">Nenhuma turma ativa.</div>') +
        (db.projetos.length ? '<h3 class="secao">Projetos</h3>' + db.projetos.map(cartaoProjeto).join('') : '') +
        (arquivadas.length ? `<details class="arquivo"><summary>Turmas arquivadas (${arquivadas.length})</summary>${arquivadas.map(cartao).join('')}</details>` : '') +
        `<button class="fab" id="imp">+ Importar planilha</button>`;
    }
    app.insertAdjacentHTML('beforeend', `<p class="muted small versao">Chamada · versão ${VERSAO}</p>`);
    const imp = $('#imp'); if (imp) imp.onclick = importarNovaTurma;
    const nova = $('#nova'); if (nova) nova.onclick = criarTurmaVazia;
    const rest = $('#restaurar'); if (rest) rest.onclick = restaurarBackup;
    const pas = $('#pasta'); if (pas) pas.onclick = () => importarPasta(null);
  }

  function menuGeral() {
    dialogo(`<h2>Menu</h2><ul class="menu-list">
      <li><button value="importar">Importar planilha (nova turma)</button></li>
      <li><button value="vazia">Criar turma vazia</button></li>
      <li><button value="varias">Importar várias planilhas (turmas antigas)</button></li>
      <li><button value="pastaProj">Importar a pasta de um projeto</button></li>
      <li><button value="pessoas">Alunos de todas as turmas</button></li>
      <li><button value="projeto">Novo projeto (instituição / departamento)</button></li>
      <li class="sep"></li>
      ${Pasta.suportada ? '<li><button value="pasta">Pasta de trabalho</button></li>' : ''}
      <li><button value="cursos">Códigos de curso</button></li>
      <li><button value="backup">Salvar backup (todas as turmas)</button></li>
      <li><button value="restaurar">Restaurar backup</button></li>
      <li><button value="apagar" style="color:var(--danger)">Apagar todas as turmas e projetos</button></li>
      <li class="sep"></li>
      <li><button value="sobre">Sobre</button></li>
      </ul>`).then(r => {
      if (r.acao === 'cursos') editarCursos();
      if (r.acao === 'pasta') configurarPasta(null);
      if (r.acao === 'importar') importarNovaTurma();
      if (r.acao === 'vazia') criarTurmaVazia();
      if (r.acao === 'varias') importarVarias();
      if (r.acao === 'pessoas') go('#/pessoas');
      if (r.acao === 'pastaProj') importarPasta(null);
      if (r.acao === 'projeto') editarProjeto(null);
      if (r.acao === 'backup') salvarBackup();
      if (r.acao === 'restaurar') restaurarBackup();
      if (r.acao === 'apagar') apagarTudo();
      if (r.acao === 'sobre') sobre();
    });
  }

  function sobre() {
    dialogo(`<h2>Sobre</h2>
      <p class="muted small">Chamada · versão ${VERSAO}</p>
      <p>Os dados ficam só neste aparelho. Faça backups de vez em quando (Menu → Salvar backup) e exporte a planilha de cada turma ao fim do período.</p>
      <p class="muted small">Faltas = F + peso × A (atraso). J (justificada) não conta como falta.</p>
      <div class="acoes"><button class="btn primary" value="">Fechar</button></div>`);
  }

  /** Cria a turma com os dados do diálogo, no projeto escolhido e na disciplina (achada ou criada);
   *  herda as regras do projeto. extra = opções de CC.vincularTurma (sigla, nível, disciplinaId…). */
  function novaTurmaDe(d, extra) {
    const p = projetoDoForm(d);
    const t = CC.novaTurma(Object.assign({}, d, { instituicao: p.instituicao }));
    const tema = String(d.tema || '').trim();
    if (tema) t.tema = tema;
    CC.vincularTurma(db, t, Object.assign({}, extra || {}, { projetoId: p.id }));
    herdarRegras(t, p);
    db.projetoPadrao = p.id;
    return t;
  }

  /** Turma vazia; a partir da tela de uma disciplina (d0), já vem com os dados dela e o plano da última turma. */
  async function criarTurmaVazia(d0) {
    d0 = d0 && d0.id ? d0 : null;
    const p0 = d0 ? projeto(d0.projetoId) : projeto(contexto.projetoId || db.projetoPadrao);
    const cfg = CC.configPadrao(p0, d0);
    const ult = d0 ? CC.turmasDaDisciplina(db, d0).sort((x, y) => ordemPeriodo(y).localeCompare(ordemPeriodo(x)))[0] : null;
    if (ult) {
      cfg.dias = (ult.config.dias || []).slice();
      cfg.categoriaDia = Object.assign({}, ult.config.categoriaDia);
      if (!d0.config.categorias) cfg.categorias = (ult.config.categorias || []).slice();
      ['cargaHoraria', 'horasAula'].forEach(k => { if (!d0.config[k] && ult.config[k]) cfg[k] = ult.config[k]; });
    }
    const plano = ult && ult.avaliacoes.length ? planoDaTurma(ult).map(v => Object.assign({}, v, { id: null, data: '' }))
      : CC.planoPadrao(2, true, !(d0 && d0.nivel === 'pos'));
    const r = await dialogo(`<h2>Nova turma</h2><div class="stack">
      <label class="field">Disciplina<input type="text" name="disciplina" value="${esc(d0 ? d0.nome : '')}" required ${d0 ? '' : 'autofocus'}></label>
      <div class="row nowrap"><label class="field grow">Código<input type="text" name="codigo" value="${esc(d0 ? d0.codigo : '')}"></label>
      <label class="field grow">Turma<input type="text" name="turma"></label></div>
      <label class="field">Período<input type="text" name="periodo" value="${esc(periodoAtualNum())}" placeholder="ex.: 20262"></label>
      ${campoProjeto(p0 && p0.id)}
      ${campoTema('')}
      ${camposPeriodo(cfg, true)}
      ${camposPlano(plano, cfg)}</div>
      <div class="acoes"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Criar</button></div>`,
      form => { ligarPlano(form); ligarPeriodo(form); ligarProjeto(form); ligarCalendario(form); });
    if (r.acao !== 'ok') return;
    const mesma = d0 && String(r.dados.codigo || '').trim() === d0.codigo && CC.norm(r.dados.disciplina) === CC.norm(d0.nome) && r.dados.projetoId === d0.projetoId;
    const t = novaTurmaDe(r.dados, mesma ? { disciplinaId: d0.id } : {});
    aplicarPeriodo(t, lerPeriodo(r.dados), !!r.dados.gerar);
    CC.aplicarPlano(t, lerPlano(r.dados));
    db.turmas.push(t); ajustarSeNova(t); salvar();
    go('#/t/' + t.id + '/alunos');
  }

  async function importarNovaTurma(arquivo) {
    const file = arquivo instanceof File ? arquivo : await escolherArquivo('.xls,.xlsx,.ods,.csv');
    if (!file) return;
    const p = await lerComAjuda(file);
    if (!p) return;

    const existente = db.turmas.find(t => p.meta.codigo && t.codigo === p.meta.codigo && t.turma === p.meta.turma && t.periodo === p.meta.periodo);
    if (existente) {
      const ok = await confirmar('Turma já existe', `Já existe a turma <b>${esc(CC.nomeTurma(existente))}</b> (${esc(existente.periodo)}). Usar esta planilha para atualizá-la?`, 'Atualizar');
      if (ok) return importarNaTurma(existente, p, file.name);
      return;
    }

    const temDados = p.datas.length || p.cronograma.length || p.notas.length || p.notasApp;
    const datasPlanilha = p.datas.concat(p.cronograma.map(c => c.data)).sort();
    const cfgPlanilha = p.configuracao ? p.configuracao.config : {};
    // Disciplina que já existe (mesmo código): sugere a carga horária e o plano dela.
    const pCtx = projeto(contexto.projetoId || db.projetoPadrao);
    const dExist = p.meta.codigo ? db.disciplinas.find(d => d.codigo === p.meta.codigo && (!pCtx || d.projetoId === pCtx.id)) : null;
    const ultExist = dExist ? CC.turmasDaDisciplina(db, dExist).sort((x, y) => ordemPeriodo(y).localeCompare(ordemPeriodo(x)))[0] : null;
    const sugestao = Object.assign(CC.configPadrao(dExist ? projeto(dExist.projetoId) : pCtx, dExist), {
      dias: diasFrequentes(datasPlanilha),
      inicio: datasPlanilha[0] || '',
      fim: p.cronograma.length ? p.cronograma.map(c => c.data).sort().pop() : ''
    }, cfgPlanilha);
    const notasSugeridas = p.notas.filter(n => n.sugerida && !/^(VR|VS)$/.test(CC.norm(n.nome)));
    const planoSugerido = p.notasApp ? p.notasApp.plano
      : notasSugeridas.length
        ? notasSugeridas.map(n => ({ nome: n.nome, tipo: 'normal', data: '', peso: 1, max: n.max })).concat(CC.planoPadrao(0, true, true))
        : ultExist && ultExist.avaliacoes.length ? planoDaTurma(ultExist).map(v => Object.assign({}, v, { id: null, data: '' }))
          : CC.planoPadrao(2, true, !(dExist && dExist.nivel === 'pos'));
    const r = await dialogo(`<h2>Nova turma</h2>
      <div class="stack">
      <label class="field">Disciplina<input type="text" name="disciplina" value="${esc(p.meta.disciplina)}"></label>
      <div class="row nowrap"><label class="field grow">Código<input type="text" name="codigo" value="${esc(p.meta.codigo)}"></label>
      <label class="field grow">Turma<input type="text" name="turma" value="${esc(p.meta.turma)}"></label>
      <label class="field grow">Período<input type="text" name="periodo" value="${esc(p.meta.periodo)}"></label></div>
      ${campoProjeto(dExist && dExist.projetoId)}
      ${campoTema((p.configuracao && p.configuracao.tema) || '')}
      <p class="muted">${p.alunos.length} alunos encontrados em <i>${esc(file.name)}</i>.${p.configuracao ? ' Configuração da turma lida da aba "Configuração".' : ''}</p>
      ${temDados ? opcoesImportacao(p, null) : ''}
      ${p.avisos.length ? `<details class="muted small"><summary>${p.avisos.length} aviso(s)</summary><ul>${p.avisos.map(a => '<li>' + esc(a) + '</li>').join('')}</ul></details>` : ''}
      ${camposPeriodo(sugestao, !p.cronograma.length && !!sugestao.fim)}
      ${camposPlano(planoSugerido)}
      </div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Criar turma</button></div>`,
      form => { ligarPlano(form); ligarPeriodo(form); ligarProjeto(form); ligarCalendario(form); });
    if (r.acao !== 'ok') return;
    const conf = p.configuracao || {};
    const t = novaTurmaDe(r.dados, { sigla: conf.sigla, nivel: conf.nivel, departamento: conf.departamento });
    const opts = lerOpcoes(r.dados, p, null);
    // Configuração da planilha (frequência, médias, nome curto); o resto vem dos campos do diálogo.
    ['freqMin', 'pesoAtraso', 'mediaMin', 'mediaVS', 'mediaMinPos'].forEach(k => { if (cfgPlanilha[k] != null) t.config[k] = cfgPlanilha[k]; });
    if (p.configuracao && p.configuracao.nomeCurto) t.nomeCurto = p.configuracao.nomeCurto;
    Object.assign(t.config, lerPeriodo(r.dados));   // tipos de aula valem já para o cronograma importado
    // O plano vem antes da importação: as notas da planilha entram nas avaliações de mesmo nome.
    CC.aplicarPlano(t, lerPlano(r.dados));
    // Planilha só com a lista (sem chamada): vale como lista oficial.
    if (!p.datas.length) CC.aplicarLista(t, p);
    const res = CC.importarDados(t, p, opts);
    aplicarPeriodo(t, lerPeriodo(r.dados), !!r.dados.gerar);
    db.turmas.push(t); ajustarSeNova(t); salvar();
    toast(`${t.alunos.length} alunos · ${t.aulas.length} aulas · ${res.marcacoes} marcações importadas`);
    go('#/t/' + t.id + '/chamada');
  }

  function opcoesImportacao(p, t) {
    let h = '<div class="checks">';
    if (p.notasApp) h += `<label><input type="checkbox" name="notasApp" checked> plano de avaliação e notas da aba Notas (${p.notasApp.plano.map(v => esc(v.nome)).join(', ')})</label>`;
    if (p.datas.length) h += `<label><input type="checkbox" name="chamada" checked> chamada (${p.datas.length} datas)</label>`;
    if (p.cronograma.length) h += `<label><input type="checkbox" name="cronograma" checked> cronograma (${p.cronograma.length} datas)</label>`;
    h += '</div>';
    if (p.notas.length) {
      h += '<p class="muted small" style="margin:10px 0 4px">Colunas que parecem notas:</p><div class="checks">' +
        p.notas.map(n => `<label><input type="checkbox" name="nota" value="${n.col}" ${n.sugerida ? 'checked' : ''}> ${esc(n.nome)}</label>`).join('') + '</div>';
    }
    // Planilha com alunos que não estão nesta turma (ex.: controle de duas turmas juntas)
    if (t && t.listaEm) {
      const fora = p.alunos.filter(d => !CC.findAluno(t, d, true)).length;
      if (fora) {
        const muitos = fora > p.alunos.length * 0.2;
        h += `<div class="checks" style="margin-top:8px"><label><input type="checkbox" name="alunosFora" ${muitos ? '' : 'checked'}> incluir ${fora} aluno(s) da planilha que não estão nesta turma (como "fora da lista")</label></div>
          ${muitos ? '<p class="muted small">A planilha parece ter alunos de outras turmas: desmarcado, só entram as marcações e notas de quem é desta turma.</p>' : ''}`;
      }
    }
    return h;
  }

  function lerOpcoes(dados, p, t) {
    const sel = [].concat(dados.nota || []).map(Number);
    return {
      alunos: !(t && t.listaEm) || !!dados.alunosFora || !p.alunos.some(d => !CC.findAluno(t, d, true)),
      notasApp: !!dados.notasApp,
      chamada: !!dados.chamada,
      cronograma: !!dados.cronograma,
      notas: p.notas.filter(n => sel.includes(n.col))
    };
  }

  /* ---------- componentes de formulário: período e plano de avaliação ---------- */

  /** Carga horária, dias da semana e período (início/fim) — para criar e configurar turmas. */
  /** Tema da turma, para disciplinas de código genérico ("Tópicos especiais em …"). */
  function campoTema(valor) {
    return `<label class="field">Tema (opcional, para "Tópicos especiais…")<input type="text" name="tema" value="${esc(valor)}" placeholder="ex.: Criptografia"></label>`;
  }

  function camposPeriodo(c, gerarMarcado) {
    const dias = c.dias || [];
    return `<fieldset class="grupo"><legend>Carga horária e aulas</legend><div class="stack">
      <div class="row nowrap">
      <label class="field grow">Carga horária (h)<input type="number" min="0" name="cargaHoraria" list="cargas" value="${c.cargaHoraria || ''}"></label>
      <label class="field grow">Horas por aula<input type="number" min="0" step="0.5" name="horasAula" value="${c.horasAula || ''}"></label></div>
      <datalist id="cargas"><option value="60"><option value="64"><option value="68"></datalist>
      <div><div class="muted small">Dias de aula (opcional)</div>
      <div class="checks">${[1, 2, 3, 4, 5, 6].map(d => `<label><input type="checkbox" name="dia" value="${d}" ${dias.includes(d) ? 'checked' : ''}> ${CC.DIAS[d]}</label>`).join('')}</div></div>
      <label class="field">Tipos de aula (opcional, separados por vírgula)<input type="text" name="categorias" value="${esc((c.categorias || []).join(', '))}" placeholder="ex.: Teórica, Laboratório"></label>
      <div class="row" id="cat-dias" data-inicial="${esc(JSON.stringify(c.categoriaDia || {}))}"></div>
      <div class="row nowrap"><label class="field grow">Início das aulas<input type="date" name="inicio" value="${c.inicio || ''}"></label>
      <label class="field grow">Fim<input type="date" name="fim" value="${c.fim || ''}"></label></div>
      <p class="muted small" id="aviso-cal"></p>
      <label class="checks"><label><input type="checkbox" name="gerar" ${gerarMarcado ? 'checked' : ''}> gerar no cronograma as aulas que faltam</label></label>
      <p class="muted small">Com dias, início e fim preenchidos, as datas de aula entram no cronograma. Os dias sem aula do calendário letivo do projeto entram como "Sem aula"; outros feriados você marca depois.</p>
      </div></fieldset>`;
  }

  const lerCategorias = txt => Array.from(new Set(String(txt || '').split(/[,;]/).map(x => x.trim()).filter(Boolean)));

  function lerPeriodo(d) {
    const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(x) ? 0 : x; };
    const dias = [].concat(d.dia || []).map(Number);
    const categorias = lerCategorias(d.categorias);
    const categoriaDia = {};
    dias.forEach(dia => { const c = d['cat' + dia]; if (c && categorias.includes(c)) categoriaDia[dia] = c; });
    return {
      cargaHoraria: num(d.cargaHoraria), horasAula: num(d.horasAula),
      dias, inicio: d.inicio || '', fim: d.fim || '', categorias, categoriaDia
    };
  }

  /** Um seletor de tipo de aula para cada dia marcado (refeito quando mudam os dias ou os tipos). */
  function ligarPeriodo(form) {
    const box = form.querySelector('#cat-dias');
    if (!box) return;
    let escolhas = {};
    try { escolhas = JSON.parse(box.dataset.inicial || '{}'); } catch (e) { /* vazio */ }
    const desenhar = () => {
      box.querySelectorAll('select').forEach(s => { escolhas[s.dataset.dia] = s.value; });
      const cats = lerCategorias(form.querySelector('[name=categorias]').value);
      const dias = [...form.querySelectorAll('[name=dia]:checked')].map(i => +i.value);
      box.innerHTML = cats.length && dias.length ? dias.map(d => `<label class="field grow">${CC.DIAS[d]}<select name="cat${d}" data-dia="${d}">
        <option value="">—</option>${cats.map(c => `<option ${escolhas[d] === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`).join('') : '';
    };
    form.querySelector('[name=categorias]').addEventListener('input', desenhar);
    form.querySelectorAll('[name=dia]').forEach(i => i.addEventListener('change', desenhar));
    desenhar();
  }

  /** Aplica o período à turma e, se pedido, gera as aulas que faltam. Devolve quantas criou. */
  function aplicarPeriodo(t, per, gerar) {
    Object.assign(t.config, per);
    CC.aplicarCategorias(t);
    if (gerar && per.dias.length && per.inicio && per.fim && per.inicio <= per.fim) {
      return CC.gerarCronograma(t, per.inicio, per.fim, per.dias, CC.calendarioDe(db, t));
    }
    return 0;
  }

  function linhaPlano(v) {
    const tipo = v.tipo || 'normal';
    const normal = tipo === 'normal';
    return `<div class="plano-linha" data-tipo="${tipo}">
      <input type="hidden" name="pId" value="${esc(v.id || '')}"><input type="hidden" name="pTipo" value="${tipo}">
      <input type="text" name="pNome" value="${esc(v.nome)}" ${normal ? '' : 'readonly'} aria-label="Nome">
      <input type="date" name="pData" value="${esc(v.data || '')}" aria-label="Data">
      ${normal ? `<input type="text" inputmode="decimal" name="pPeso" value="${String(v.peso).replace('.', ',')}" aria-label="Peso">`
        : `<input type="hidden" name="pPeso" value="0"><span class="muted small" style="align-self:center;text-align:center">—</span>`}
      <input type="text" inputmode="decimal" name="pMax" value="${String(v.max).replace('.', ',')}" aria-label="Nota máxima">
    </div>`;
  }

  /** Plano de avaliação: quantas avaliações entram na média (nome, data, peso, nota máxima) + VR e VS. */
  function camposPlano(plano, cfg) {
    const c = cfg || CC.DEFAULT_CONFIG;
    const normais = plano.filter(v => !v.tipo || v.tipo === 'normal');
    const vr = plano.find(v => v.tipo === 'VR'), vs = plano.find(v => v.tipo === 'VS');
    return `<fieldset class="grupo"><legend>Avaliações</legend>
      <label class="field">Quantas entram na média<input type="number" name="nAval" min="0" max="12" value="${normais.length}"></label>
      <div class="plano-cab muted small"><span>Nome</span><span>Data</span><span>Peso</span><span>Máx.</span></div>
      <div class="plano-normais">${normais.map(linhaPlano).join('')}</div>
      <div class="checks" style="margin-top:10px">
        <label><input type="checkbox" name="temVR" ${vr ? 'checked' : ''}> VR — substitui a nota da prova perdida</label>
        <label><input type="checkbox" name="temVS" ${vs ? 'checked' : ''}> VS — para média entre ${CC.numBR(c.mediaVS)} e ${CC.numBR(c.mediaMin)}</label></div>
      <div class="plano-extra">
        ${linhaPlano(vr || { nome: 'VR', tipo: 'VR', data: '', peso: 0, max: 10 })}
        ${linhaPlano(vs || { nome: 'VS', tipo: 'VS', data: '', peso: 0, max: 10 })}</div>
      <p class="muted small">Média = soma(peso × nota ÷ máx. × 10) ÷ soma dos pesos. A data marca a aula como avaliação no cronograma.</p>
      </fieldset>`;
  }

  /** Liga o número de avaliações às linhas e as caixas VR/VS às linhas extras. */
  function ligarPlano(form) {
    const box = form.querySelector('.plano-normais');
    if (!box) return;
    const n = form.querySelector('[name=nAval]');
    n.addEventListener('input', () => {
      const alvo = Math.max(0, Math.min(12, parseInt(n.value, 10) || 0));
      while (box.children.length > alvo) box.lastElementChild.remove();
      while (box.children.length < alvo) {
        const k = box.children.length + 1;
        box.insertAdjacentHTML('beforeend', linhaPlano({ nome: 'P' + k, tipo: 'normal', data: '', peso: 1, max: 10 }));
      }
    });
    const extra = tipo => form.querySelector(`.plano-extra [data-tipo="${tipo}"]`);
    const sync = () => ['VR', 'VS'].forEach(tipo => {
      const on = form.querySelector(`[name=tem${tipo}]`).checked;
      const row = extra(tipo);
      row.hidden = !on;
      row.querySelectorAll('input').forEach(i => { i.disabled = !on; });
    });
    form.querySelectorAll('[name=temVR],[name=temVS]').forEach(c => c.addEventListener('change', sync));
    sync();
  }

  function lerPlano(d) {
    const arr = k => [].concat(d[k] == null ? [] : d[k]);
    const ids = arr('pId'), tipos = arr('pTipo'), nomes = arr('pNome'), datas = arr('pData'), pesos = arr('pPeso'), maxs = arr('pMax');
    const num = (v, padrao) => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? padrao : x; };
    return nomes.map((nome, i) => ({
      id: ids[i] || null, tipo: tipos[i] || 'normal', nome: String(nome).trim(), data: datas[i] || '',
      peso: tipos[i] === 'normal' ? num(pesos[i], 1) : 0, max: num(maxs[i], 10)
    })).filter(v => v.nome && v.max > 0);
  }

  /** Plano atual da turma (para preencher o editor). */
  function planoDaTurma(t) {
    return t.avaliacoes.map(v => ({ id: v.id, nome: v.nome, tipo: v.tipo || 'normal', data: v.data || '', peso: v.peso, max: v.max }));
  }

  async function editarPlano(t) {
    const r = await dialogo(`<h2>Plano de avaliação</h2>${camposPlano(planoDaTurma(t), t.config)}
      <div class="acoes"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`, ligarPlano);
    if (r.acao !== 'ok') return;
    const plano = lerPlano(r.dados);
    const ficam = new Set(plano.map(v => v.id).filter(Boolean));
    const somem = t.avaliacoes.filter(v => !ficam.has(v.id) && Object.keys(t.notas[v.id] || {}).length);
    if (somem.length) {
      const ok = await confirmar('Remover avaliações com notas', `${somem.map(v => '<b>' + esc(v.nome) + '</b>').join(', ')} já ${somem.length > 1 ? 'têm' : 'tem'} notas lançadas, que serão apagadas. Continuar?`, 'Remover', true);
      if (!ok) return;
    }
    CC.aplicarPlano(t, plano);
    salvar(); go(`#/t/${t.id}/notas`);
    toast('Plano salvo');
  }

  /** Dias da semana que aparecem pelo menos duas vezes numa lista de datas. */
  function diasFrequentes(datas) {
    const n = {};
    datas.forEach(d => { const w = CC.weekday(d); n[w] = (n[w] || 0) + 1; });
    return Object.keys(n).filter(w => n[w] >= 2).map(Number).sort();
  }

  /* ---------- menu da turma: atualizar lista, importar, exportar ---------- */

  function menuTurma(t) {
    dialogo(`<h2>${esc(CC.nomeTurma(t))}</h2><ul class="menu-list">
      <li><button value="exportar">Exportar planilha (.xlsx)</button></li>
      <li><button value="presenca">Lista de presença para assinatura (PDF ou planilha)</button></li>
      <li><button value="email">Enviar e-mail aos alunos</button></li>
      <li><button value="lista">Atualizar lista de alunos (planilha nova do sistema)</button></li>
      <li><button value="importar">Importar chamada / notas / cronograma de planilha</button></li>
      <li class="sep"></li>
      <li><button value="plano">Plano de avaliação</button></li>
      <li><button value="config">Configurações da turma</button></li>
      ${Pasta.suportada ? '<li><button value="pasta">Pasta de trabalho desta turma</button></li>' : ''}
      <li><button value="backup">Salvar backup desta turma</button></li>
      <li><button value="arquivar">${t.arquivada ? 'Desarquivar turma' : 'Arquivar turma (fim do período)'}</button></li>
      <li class="sep"></li>
      <li><button value="excluir" class="danger" style="color:var(--danger)">Excluir turma</button></li>
      </ul>`).then(r => {
      if (r.acao === 'exportar') exportar(t);
      if (r.acao === 'presenca') listaPresenca(t, null);
      if (r.acao === 'email') enviarEmail(t, null);
      if (r.acao === 'arquivar') alternarArquivo(t);
      if (r.acao === 'pasta') configurarPasta(t);
      if (r.acao === 'lista') atualizarLista(t);
      if (r.acao === 'importar') importarArquivoNaTurma(t);
      if (r.acao === 'config') configTurma(t);
      if (r.acao === 'plano') editarPlano(t);
      if (r.acao === 'backup') salvarBackup(t);
      if (r.acao === 'excluir') excluirTurma(t);
    });
  }

  /** Data de uma lista: a do nome do arquivo (ex.: …-2024jul08.xls) ou a da última modificação. */
  function dataDoArquivo(file) {
    return CC.dataNoNome(file.name) || (file.lastModified ? new Date(file.lastModified).toISOString().slice(0, 10) : CC.todayISO());
  }

  async function atualizarLista(t) {
    const files = await escolherDoSistema('.xls,.xlsx,.ods,.csv', true);
    if (!files || !files.length) return;
    if (files.length > 1) return atualizarVariasListas(t, files);
    const file = files[0];
    const p = await lerComAjuda(file);
    if (!p) return;
    if (p.meta.codigo && t.codigo && (p.meta.codigo !== t.codigo || (p.meta.turma && t.turma && p.meta.turma !== t.turma))) {
      const ok = await confirmar('Turma diferente?', `A planilha é de <b>${esc(p.meta.codigo + ' ' + p.meta.turma)}</b>, mas esta turma é <b>${esc(t.codigo + ' ' + t.turma)}</b>. Continuar mesmo assim?`, 'Continuar');
      if (!ok) return;
    }
    const plano = CC.diffLista(t, p);
    const lista = (arr, f) => arr.length ? '<ul>' + arr.map(x => '<li>' + esc(f(x)) + '</li>').join('') + '</ul>' : '';
    const r = await dialogo(`<h2>Atualizar lista</h2><div class="scroll">
      <p><b>${plano.novos.length}</b> novo(s)${lista(plano.novos, a => a.nome)}</p>
      <p><b>${plano.saem.length}</b> sai(em) da lista <span class="muted small">(o histórico é mantido)</span>${lista(plano.saem, a => a.nome)}</p>
      ${plano.voltaram.length ? `<p><b>${plano.voltaram.length}</b> voltam à lista${lista(plano.voltaram, a => a.nome)}</p>` : ''}
      ${t.semAvulsos && plano.novos.some(a => CC.vinculoAluno(t, a) === 'A') ? `<p class="small" style="color:var(--A)">Esta disciplina não aceita alunos avulsos, mas a lista tem ${plano.novos.filter(a => CC.vinculoAluno(t, a) === 'A').length} novo(s) com matrícula de avulso.</p>` : ''}
      ${plano.alterados.length ? `<p><b>${plano.alterados.length}</b> com dados alterados${lista(plano.alterados, x => x.aluno.nome + ' (' + x.campos.join(', ') + ')')}</p>` : ''}
      <p class="muted">${plano.mantidos} sem mudança.</p></div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Aplicar</button></div>`);
    if (r.acao !== 'ok') return;
    CC.aplicarLista(t, p);
    salvar(); render();
    toast('Lista atualizada');
  }

  /** Várias listas oficiais (ex.: tiradas ao longo do semestre): aplicadas da mais antiga à mais nova, cada uma
   *  com a sua data — assim fica registrado quando cada aluno entrou e saiu. */
  async function atualizarVariasListas(t, files) {
    const itens = [];
    for (const f of files) {
      let p; try { p = await lerPlanilha(f); } catch (e) { p = null; }
      itens.push({ f, p, data: dataDoArquivo(f) });
    }
    const validos = itens.filter(i => i.p && i.p.alunos.length).sort((a, b) => a.data.localeCompare(b.data));
    // Simula numa cópia para mostrar o que cada lista muda.
    const copia = JSON.parse(JSON.stringify(t));
    const linhas = validos.map(i => {
      const pl = CC.aplicarLista(copia, i.p, i.data);
      return `<li><b>${CC.fmtDate(i.data)}</b> · ${esc(i.f.name)} — ${i.p.alunos.length} alunos · ${pl.novos.length} novo(s) · ${pl.saem.length} saem</li>`;
    }).join('');
    const ruins = itens.filter(i => !i.p || !i.p.alunos.length).map(i => esc(i.f.name));
    const r = await dialogo(`<h2>Atualizar com ${validos.length} lista(s)</h2>
      <p class="muted small">Aplicadas em ordem de data (a do nome do arquivo ou a da última modificação). Quem sai fica "fora da lista" com a data em que saiu.</p>
      <div class="scroll"><ol class="small">${linhas}</ol>${ruins.length ? `<p class="muted small">Sem alunos reconhecidos: ${ruins.join(', ')}</p>` : ''}</div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok" ${validos.length ? '' : 'disabled'}>Aplicar</button></div>`);
    if (r.acao !== 'ok') return;
    validos.forEach(i => CC.aplicarLista(t, i.p, i.data));
    salvar(); render();
    toast(`${validos.length} lista(s) aplicada(s)`);
  }

  /** Várias planilhas de uma vez (ex.: turmas de semestres passados): uma turma nova para cada. */
  async function importarVarias(arquivos) {
    const files = arquivos || await escolherDoSistema('.xls,.xlsx,.ods,.csv', true);
    if (!files || !files.length) return;
    toast('Lendo ' + files.length + ' planilha(s)…');
    const itens = [];
    for (const f of files) {
      let p = null; try { p = await lerPlanilha(f); } catch (e) { /* ilegível */ }
      const id = (cod, disc, tur, per, tema) => [cod || CC.norm(disc), tur, per, tema || ''].join('|');
      const chave = p && id(p.meta.codigo, p.meta.disciplina, p.meta.turma, p.meta.periodo, p.configuracao && p.configuracao.tema);
      const existe = p && (p.meta.codigo || p.meta.disciplina) && (db.turmas.some(t => id(t.codigo, t.disciplina, t.turma, t.periodo, t.tema) === chave) ||
        itens.some(i => i.chave === chave));
      if (p) Object.defineProperty(p, 'chave', { value: chave });
      itens.push({ f, p, existe, chave });
    }
    const ok = itens.filter(i => i.p && i.p.alunos.length && !i.existe && pareceTurma(i));
    const periodoAtual = (d => d.getFullYear() + (d.getMonth() < 7 ? '1' : '2'))(new Date());
    const lin = i => !i.p ? 'não abriu' : !i.p.alunos.length ? 'sem alunos reconhecidos (importe sozinha para escolher as colunas)'
      : i.existe ? 'já existe esta turma' : !pareceTurma(i) ? 'ignorada: não parece uma turma (sem período ou é um resumo); importe sozinha se for' : `${esc([i.p.meta.codigo, i.p.meta.turma, i.p.meta.periodo].filter(Boolean).join(' ') || i.p.meta.disciplina || '?')} · ${i.p.alunos.length} alunos`;
    const r = await dialogo(`<h2>Importar ${files.length} planilha(s)</h2>
      <div class="scroll"><ul class="small">${itens.map(i => `<li>${ok.includes(i) ? '✓' : '—'} ${esc(i.f.name)}: ${lin(i)}</li>`).join('')}</ul></div>
      <div class="checks"><label><input type="checkbox" name="arquivar" checked> arquivar as turmas de períodos anteriores a ${periodoAtual.slice(0, 4)}/${periodoAtual[4]}</label></div>
      <p class="muted small">Planilhas exportadas pelo app trazem também configuração, plano de avaliação e notas.</p>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok" ${ok.length ? '' : 'disabled'}>Importar ${ok.length}</button></div>`);
    if (r.acao !== 'ok') return;
    criarTurmasDePlanilhas(ok, projeto(contexto.projetoId), !!r.dados.arquivar);
    salvar(); render();
    toast(`${ok.length} turma(s) importada(s)`);
  }

  async function importarArquivoNaTurma(t) {
    const file = await escolherArquivo('.xls,.xlsx,.ods,.csv', false, t);
    if (!file) return;
    const p = await lerComAjuda(file);
    if (p) importarNaTurma(t, p, file.name);
  }

  async function importarNaTurma(t, p, nomeArq) {
    // Planilha de correção de prova (notas por subitem): vai para uma avaliação, não para a chamada.
    if (p.provas && p.provas.length && !p.datas.length) return importarProvas(t, p, nomeArq);
    if (!p.alunos.length) return toast(p.avisos[0] || 'Não encontrei alunos nessa planilha.');
    if (!p.datas.length && !p.cronograma.length && !p.notas.length && !p.notasApp) {
      // Só a lista: tratar como atualização da lista oficial.
      const plano = CC.aplicarLista(t, p);
      salvar(); render();
      return toast(`Lista atualizada: ${plano.novos.length} novos, ${plano.saem.length} saíram`);
    }
    const r = await dialogo(`<h2>Importar de ${esc(nomeArq)}</h2>
      <p class="muted small">Só preenche o que ainda está vazio no app; nada que você já marcou é sobrescrito.
      Alunos da planilha que não estão na lista oficial entram como "fora da lista".</p>
      ${opcoesImportacao(p, t)}
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Importar</button></div>`);
    if (r.acao !== 'ok') return;
    const res = CC.importarDados(t, p, lerOpcoes(r.dados, p, t));
    salvar(); render();
    toast(`${res.aulasNovas} aulas, ${res.marcacoes} marcações, ${res.notas} notas, ${res.alunosNovos} alunos novos`);
  }

  /** Próxima avaliação (de hoje em diante): sugestão para o cabeçalho da lista de presença. */
  function proximaAvaliacao(t) {
    const hoje = CC.todayISO();
    return CC.aulasOrdenadas(t).find(a => a.tipo === 'avaliacao' && a.data >= hoje) || null;
  }

  /** Campos da lista de presença: título, data, linhas em branco e quem entra (ligar com ligarLista). */
  function camposLista(t, aula) {
    const conteudo = aula && aula.conteudo ? aula.conteudo : '';
    const sugerido = /^VS\b/i.test(conteudo) ? 'vs' : /^VR\b/i.test(conteudo) ? 'vr' : 'ativos';
    const crit = CC.criteriosLista(t), c = t.config;
    const todos = CC.alunosOrdenados(t, true);
    return `<label class="field">Título<input type="text" name="titulo" value="${esc(conteudo)}" placeholder="ex.: P1 (pode deixar vazio)"></label>
      <div class="row nowrap"><label class="field grow">Data<input type="date" name="data" value="${aula ? aula.data : ''}"></label>
      <label class="field grow">Linhas em branco<input type="number" name="extras" min="0" max="40" value="3"></label></div>
      <label class="field">Alunos na lista<select name="criterio">${Object.keys(crit).map(k => `<option value="${k}" ${k === sugerido ? 'selected' : ''}>${esc(crit[k])}</option>`).join('')}</select></label>
      <div class="row nowrap" data-crit="faixa" hidden>
        <label class="field grow">Média parcial de (≥)<input type="number" step="0.1" min="0" max="10" name="min" value="${c.mediaVS}"></label>
        <label class="field grow">até menos de (&lt;)<input type="number" step="0.1" min="0" max="10.1" name="max" value="${c.mediaMin}"></label></div>
      <div class="checks" data-crit="faixa" hidden><label><input type="checkbox" name="freq" checked> só quem tem frequência suficiente</label></div>
      <div data-crit="manual" hidden>
        <div class="row nowrap small"><button type="button" class="btn" data-marcar="1">Marcar todos</button><button type="button" class="btn" data-marcar="0">Desmarcar</button></div>
        <div class="checks lista-manual">${todos.map(a => `<label><input type="checkbox" name="ids" value="${esc(a.id)}" ${a.ativo ? 'checked' : ''}> ${esc(a.nome)}${a.ativo ? '' : ' <span class="muted">(saiu)</span>'}</label>`).join('')}</div>
      </div>
      <p class="muted small" id="lista-conta"></p>`;
  }

  function lerLista(d) {
    const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(x) ? null : x; };
    return {
      titulo: String(d.titulo || '').trim(), data: d.data || '', extras: Math.max(0, Math.min(40, parseInt(d.extras, 10) || 0)),
      criterio: { tipo: d.criterio || 'ativos', min: num(d.min), max: num(d.max), freq: !!d.freq, ids: [].concat(d.ids || []) }
    };
  }

  /** Mostra os campos do critério escolhido e conta quem vai para a lista. */
  function ligarLista(form, t) {
    const sel = form.querySelector('[name=criterio]');
    const atualizar = () => {
      form.querySelectorAll('[data-crit]').forEach(el => { el.hidden = el.dataset.crit !== sel.value; });
      const dados = {};
      new FormData(form).forEach((v, k) => { dados[k] = k in dados ? [].concat(dados[k], v) : v; });
      const ol = lerLista(dados);
      const lista = CC.alunosParaLista(t, ol.criterio);
      const risc = lista.filter(a => CC.reprovadoPorFalta(t, CC.statsAluno(t, a).faltas)).length;
      const lim = CC.limiteFaltas(t);
      form.querySelector('#lista-conta').textContent = `${lista.length} aluno(s) na lista` +
        (risc ? ` · ${risc} com mais de ${CC.numBR(lim, lim % 1 ? 1 : 0)} faltas aparecerão riscados` : '') + '.';
    };
    form.addEventListener('change', atualizar);
    form.addEventListener('input', atualizar);
    form.querySelectorAll('[data-marcar]').forEach(b => b.addEventListener('click', () => {
      form.querySelectorAll('.lista-manual input').forEach(i => { i.checked = b.dataset.marcar === '1'; });
      atualizar();
    }));
    atualizar();
  }

  function semXLSX() {
    if (window.XLSX) return false;
    toast('Biblioteca de planilhas não carregou (abra o app uma vez com internet).');
    return true;
  }

  function entregarPlanilha(t, lista) {
    const p = CC.projetoDe(db, t), d = CC.disciplinaDe(db, t);
    const wb = CC.montarPlanilha(XLSX, t, cursos(t), { lista, departamento: (p && p.departamento) || (d && d.departamento) || '' });
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
    // Na pasta do projeto, o nome segue o da pasta da disciplina: UFF-TCC00305-LFTC-2026b[-turma].xlsx
    let naPasta = '';
    if (d && d.pasta) {
      const varias = CC.turmasDaDisciplina(db, d).filter(u => u.periodo === t.periodo).length > 1;
      naPasta = (d.pasta + '-' + CC.periodoLetra(t.periodo) + (varias && t.turma ? '-' + t.turma : '')).replace(/[\\/:*?"<>|]+/g, '-') + '.xlsx';
    }
    entregarArquivo(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), CC.nomeArquivo(t, 'planilha', 'xlsx'), t, naPasta);
  }

  /** Exporta a planilha; a aba "Lista de presença" é opcional. */
  async function exportar(t) {
    if (semXLSX()) return;
    const r = await dialogo(`<h2>Exportar planilha</h2>
      <p class="muted small">Abas: Chamada, Notas, Estatísticas (com plano de avaliação), Cronograma, Alunos, Observações e Configuração.</p>
      <div class="checks"><label><input type="checkbox" name="comLista" id="com-lista"> incluir a aba Lista de presença (para assinatura)</label></div>
      <div class="stack" id="campos-lista" hidden>${camposLista(t, proximaAvaliacao(t))}</div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Exportar</button></div>`,
      form => {
        const c = form.querySelector('#com-lista');
        c.onchange = () => { form.querySelector('#campos-lista').hidden = !c.checked; };
        ligarLista(form, t);
      });
    if (r.acao !== 'ok') return;
    entregarPlanilha(t, r.dados.comLista ? lerLista(r.dados) : null);
  }

  /** Lista de presença para assinatura: PDF pronto para imprimir ou planilha (ajustável no Excel). */
  async function listaPresenca(t, aula) {
    aula = aula || proximaAvaliacao(t);
    const r = await dialogo(`<h2>Lista de presença</h2>
      <div class="stack">${camposLista(t, aula)}</div>
      <p class="muted small"><b>PDF</b>: pronto para imprimir (A4). <b>Planilha</b>: a planilha completa com a aba da lista, para ajustar larguras e alturas no Excel.</p>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn" value="xlsx">Planilha</button><button class="btn primary" value="pdf">PDF</button></div>`,
      form => ligarLista(form, t));
    if (!r.acao) return;
    const ol = lerLista(r.dados);
    if (!CC.alunosParaLista(t, ol.criterio).length && !ol.extras) return toast('Nenhum aluno atende ao critério escolhido.');
    if (r.acao === 'xlsx') { if (!semXLSX()) entregarPlanilha(t, ol); return; }
    toast('Gerando PDF…');
    let blob;
    try { blob = await ListaPDF.gerar(CC.dadosListaPresenca(t, cursos(t), ol)); }
    catch (e) { return toast('Não consegui gerar o PDF: ' + e.message); }
    const rotulo = ol.titulo || (ol.data ? CC.fmtDate(ol.data).slice(0, 5).replace('/', '-') : '');
    entregarArquivo(blob, CC.nomeArquivo(t, 'lista de presença' + (rotulo ? ' ' + rotulo : ''), 'pdf'), t);
  }

  async function configTurma(t) {
    const c = t.config;
    const r = await dialogo(`<h2>Configurações</h2><div class="stack">
      <label class="field">Disciplina<input type="text" name="disciplina" value="${esc(t.disciplina)}"></label>
      <div class="row nowrap"><label class="field grow">Código<input type="text" name="codigo" value="${esc(t.codigo)}"></label>
      <label class="field grow">Turma<input type="text" name="turma" value="${esc(t.turma)}"></label>
      <label class="field grow">Período<input type="text" name="periodo" value="${esc(t.periodo)}"></label></div>
      ${campoProjeto(t.projetoId)}
      <p class="muted small" style="margin-top:-6px">Mudar o código (ou o projeto) põe a turma em outra disciplina; mudar só o nome renomeia a disciplina (vale para todas as turmas dela).</p>
      ${campoTema(t.tema || '')}
      <label class="field">Nome curto (nos nomes dos arquivos)<input type="text" name="nomeCurto" maxlength="40" value="${esc(t.nomeCurto || '')}" placeholder="${esc(CC.nomeCurto(Object.assign({}, t, { nomeCurto: '' })))}"></label>
      <div class="row nowrap">
      <label class="field grow">Atraso vale (faltas)<input type="number" step="0.05" min="0" max="1" name="pesoAtraso" value="${c.pesoAtraso}"></label>
      <label class="field grow">Frequência mínima (%)<input type="number" min="0" max="100" name="freqMin" value="${c.freqMin}"></label>
      <label class="field grow">Média mínima<input type="number" step="0.1" min="0" max="10" name="mediaMin" value="${c.mediaMin}"></label></div>
      <div class="row nowrap">
      <label class="field grow">Com média parcial a partir de (faz VS)<input type="number" step="0.1" min="0" max="10" name="mediaVS" value="${c.mediaVS}"></label>
      <label class="field grow">Média mínima na pós (sem VS)<input type="number" step="0.1" min="0" max="10" name="mediaMinPos" value="${c.mediaMinPos == null ? '' : c.mediaMinPos}" placeholder="igual à graduação"></label></div>
      ${camposPeriodo(c, false)}
      <p class="muted small">Hoje: ${CC.aulasPrevistas(t)} aulas no período; reprova quem tiver mais de ${CC.numBR(CC.limiteFaltas(t), CC.limiteFaltas(t) % 1 ? 1 : 0)} faltas.
      Sem carga horária, conta as aulas do cronograma.</p></div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`,
    form => { ligarPeriodo(form); ligarProjeto(form); ligarCalendario(form); });
    if (r.acao !== 'ok') return;
    const discAntes = CC.disciplinaDe(db, t), codAntes = t.codigo, nomeAntes = t.disciplina;
    ['disciplina', 'codigo', 'turma', 'periodo'].forEach(k => { t[k] = String(r.dados[k] || '').trim(); });
    const pNovo = projetoDoForm(r.dados);
    const mudou = !discAntes || pNovo.id !== t.projetoId || t.codigo !== codAntes || (!t.codigo && CC.norm(t.disciplina) !== CC.norm(nomeAntes));
    const sozinha = discAntes && CC.turmasDaDisciplina(db, discAntes).length === 1;
    const destino = t.codigo && db.disciplinas.find(d => d !== discAntes && d.projetoId === pNovo.id && d.codigo === t.codigo);
    if (mudou && sozinha && !destino) {
      // Única turma da disciplina (ex.: código digitado errado): corrige a própria disciplina, que guarda a pasta e o padrão.
      Object.assign(discAntes, { codigo: t.codigo, nome: t.disciplina || discAntes.nome, projetoId: pNovo.id });
      CC.sincronizarDisciplina(db, discAntes);
    } else if (mudou) {
      const n0 = db.disciplinas.length;
      const v = CC.vincularTurma(db, t, { projetoId: pNovo.id });
      if (db.disciplinas.length > n0) CC.ajustarDisciplina(db, v.d);
      CC.limparDisciplinas(db);
    } else if (t.disciplina && t.disciplina !== nomeAntes) {
      discAntes.nome = t.disciplina;
      CC.sincronizarDisciplina(db, discAntes);
    }
    const curto = String(r.dados.nomeCurto || '').trim();
    if (curto) t.nomeCurto = curto; else delete t.nomeCurto;
    const tema = String(r.dados.tema || '').trim();
    if (tema) t.tema = tema; else delete t.tema;
    ['pesoAtraso', 'freqMin', 'mediaMin', 'mediaVS'].forEach(k => {
      const v = parseFloat(String(r.dados[k]).replace(',', '.'));
      if (!isNaN(v)) c[k] = v;
    });
    const vPos = parseFloat(String(r.dados.mediaMinPos || '').replace(',', '.'));
    c.mediaMinPos = isNaN(vPos) ? null : vPos;
    delete c.totalAulas;
    const novas = aplicarPeriodo(t, lerPeriodo(r.dados), !!r.dados.gerar);
    salvar(); render();
    if (novas) toast(novas + ' aula(s) adicionada(s) ao cronograma');
  }

  async function excluirTurma(t) {
    const ok = await confirmar('Excluir turma', `Apagar <b>${esc(CC.nomeTurma(t))}</b> e toda a chamada e notas dela deste aparelho? Se quiser guardar, exporte ou faça backup antes.`, 'Excluir', true);
    if (!ok) return;
    db.turmas = db.turmas.filter(x => x.id !== t.id);
    CC.limparDisciplinas(db);
    salvar(); go(t.disciplinaId && disciplina(t.disciplinaId) ? '#/d/' + t.disciplinaId : '#/');
  }

  function salvarBackup(t) {
    const dados = t ? { versao: 1, turmas: [t] } : db;
    const nome = CC.nomeArquivo(t || null, 'backup ' + CC.todayISO(), 'json');
    entregarArquivo(new Blob([JSON.stringify(dados)], { type: 'application/json' }), nome, t || null);
  }

  /** Começar do zero: apaga turmas, projetos e disciplinas deste aparelho (a tabela de cursos e os modelos de e-mail ficam). */
  async function apagarTudo() {
    const n = db.turmas.length;
    const ok = await confirmar('Apagar tudo', `Apagar as ${n} turma(s), os projetos, as disciplinas e o calendário letivo deste aparelho? Não tem volta. Se quiser guardar, salve antes um backup (menu ⋮).`, 'Apagar tudo', true);
    if (!ok) return;
    const ids = db.projetos.map(p => p.id);
    db.turmas = []; db.projetos = []; db.disciplinas = [];
    delete db.projetoPadrao;
    ids.forEach(id => Pasta.esquecer('p:' + id).catch(() => {}));
    gravarAgora(); go('#/');
    toast(n + ' turma(s) apagada(s)');
  }

  async function restaurarBackup() {
    const file = await escolherArquivo('.json,application/json');
    if (!file) return;
    let dados;
    try { dados = JSON.parse(await file.text()); } catch (e) { return toast('Arquivo de backup inválido'); }
    if (!dados || !Array.isArray(dados.turmas)) return toast('Arquivo de backup inválido');
    const conflitos = dados.turmas.filter(t => turma(t.id));
    let substituir = true;
    if (conflitos.length) {
      substituir = await confirmar('Restaurar backup', `${conflitos.length} turma(s) do backup já existem aqui. Substituir pelas versões do backup?`, 'Substituir', true);
      if (!substituir) return;
    }
    dados.turmas.forEach(t => {
      t.config = Object.assign({}, CC.DEFAULT_CONFIG, t.config);
      const i = db.turmas.findIndex(x => x.id === t.id);
      if (i >= 0) db.turmas[i] = t; else db.turmas.push(t);
    });
    ['projetos', 'disciplinas'].forEach(k => (dados[k] || []).forEach(x => {
      const i = db[k].findIndex(y => y.id === x.id);
      if (i >= 0) db[k][i] = x; else db[k].push(x);
    }));
    CC.organizar(db);
    salvar(); go('#/');
    toast(dados.turmas.length + ' turma(s) restaurada(s)');
  }

  /* ---------- cursos ---------- */

  function resumoCursos(t, alunos) {
    const n = {};
    alunos.forEach(a => { const c = cursoDe(t, a) || 'sem matrícula'; n[c] = (n[c] || 0) + 1; });
    return Object.keys(n).sort((x, y) => n[y] - n[x]).map(c => esc(c) + ': ' + n[c]).join(' · ');
  }

  async function editarCursos() {
    const tab = cursos();
    const usados = CC.cursosEncontrados(db.turmas);
    const codigos = Array.from(new Set(Object.keys(tab).concat(Object.keys(usados)))).sort();
    const texto = codigos.map(c => c + ' = ' + (tab[c] || '')).join('\n');
    const semNome = Object.keys(usados).filter(c => !tab[c]);
    const r = await dialogo(`<h2>Códigos de curso</h2>
      <p class="muted small">Um por linha: <b>código = nome</b>. O código são os dígitos 4 a 6 da matrícula
      (2&nbsp;23&nbsp;<b>031</b>&nbsp;134 → 031). A tabela inicial é a da UFF de 2006; corrija ou acrescente o que faltar.</p>
      ${semNome.length ? `<p class="small" style="color:var(--A)">Códigos das suas turmas ainda sem nome: ${semNome.join(', ')}</p>` : ''}
      <textarea name="tabela" style="min-height:45vh;font-family:monospace;font-size:14px">${esc(texto)}</textarea>
      <div class="acoes"><button class="btn danger" value="padrao" formnovalidate>Restaurar tabela da UFF</button>
      <button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao === 'padrao') { delete db.cursos; salvar(); render(); return toast('Tabela da UFF restaurada'); }
    if (r.acao !== 'ok') return;
    const nova = {};
    String(r.dados.tabela).split(/\r?\n/).forEach(l => {
      const m = l.match(/^\s*(\d{1,3})\s*[=:;\t-]\s*(.+?)\s*$/);
      if (m) nova[m[1].padStart(3, '0')] = m[2];
    });
    db.cursos = nova;
    salvar(); render();
    toast(Object.keys(nova).length + ' cursos salvos');
  }

  /* ---------- leitura de folha de presença por foto (OCR no aparelho) ---------- */

  const ETAPAS_OCR = {
    'loading tesseract core': 'Carregando o leitor de texto…',
    'initializing tesseract': 'Preparando o leitor…',
    'loading language traineddata': 'Carregando o português (só na 1ª vez demora)…',
    'initializing api': 'Preparando o leitor…',
    'recognizing text': 'Lendo a folha…'
  };

  function progressoOCR(texto, frac) {
    const el = document.querySelector('#ocr-progresso');
    if (!el) return;
    el.querySelector('.txt').textContent = texto;
    el.querySelector('progress').value = frac || 0;
  }

  async function lerFolhaPresenca(t, aula) {
    const fotos = await escolherDoSistema('image/*', true);
    if (!fotos || !fotos.length) return;
    const dlg = $('#dlg'), form = $('#dlg-form');
    form.innerHTML = `<h2>Lendo ${fotos.length > 1 ? fotos.length + ' fotos' : 'a foto'}</h2>
      <div id="ocr-progresso"><p class="txt muted">Começando…</p><progress max="1" value="0" style="width:100%"></progress></div>
      <p class="muted small">Tudo é feito no aparelho; a foto não sai do celular.</p>`;
    dlg.returnValue = '';
    dlg.showModal();
    const alunos = CC.alunosOrdenados(t, false);
    let linhas = [], tipo = 'mao';
    try {
      for (let k = 0; k < fotos.length; k++) {
        const r = await OCR.lerFolha(fotos[k], alunos, (st, p) => {
          progressoOCR((fotos.length > 1 ? `Foto ${k + 1} de ${fotos.length}: ` : '') + (ETAPAS_OCR[st] || 'Processando…'), st === 'recognizing text' ? p : 0);
        }, a => cursoDe(t, a));
        if (r.tipo === 'impressa') tipo = 'impressa';
        linhas = linhas.concat(r.linhas);
      }
    } catch (e) {
      await fecharDialogo();
      return toast('Não consegui ler a foto: ' + e.message);
    }
    await fecharDialogo();
    // Entre fotos diferentes, um aluno também só vale uma vez (fica a linha de maior score).
    const melhor = new Map();
    linhas.forEach((l, i) => {
      if (!l.aluno) return;
      const j = melhor.get(l.aluno.id);
      if (j == null || l.candidatos[0].score > linhas[j].candidatos[0].score) melhor.set(l.aluno.id, i);
    });
    linhas.forEach((l, i) => { if (l.aluno && melhor.get(l.aluno.id) !== i) { l.aluno = null; l.presente = false; l.duplicada = true; } });
    conferirLeitura(t, aula, linhas, tipo);
  }

  async function conferirLeitura(t, aula, linhas, tipo) {
    const alunos = CC.alunosOrdenados(t, false);
    const opcoes = sel => '<option value="">— ignorar esta linha —</option>' +
      alunos.map(a => `<option value="${a.id}" ${sel && sel.id === a.id ? 'selected' : ''}>${esc(nomeCurto(a.nome))}</option>`).join('');
    const reconhecidos = new Set(linhas.filter(l => l.aluno).map(l => l.aluno.id));
    const fora = alunos.filter(a => !reconhecidos.has(a.id));
    const nPres = linhas.filter(l => l.presente).length;
    const r = await dialogo(`<h2>Conferir leitura · ${CC.fmtDate(aula.data, true)}</h2>
      <p class="muted small">${tipo === 'impressa' ? 'Lista impressa: presente = linha com assinatura.' : 'Folha escrita à mão: cada linha foi comparada com os alunos da turma.'}
      ${nPres} presença(s) sugerida(s). Confira as linhas, corrija o aluno quando preciso e desmarque o que estiver errado.</p>
      <div class="ocr-lista">${linhas.map((l, i) => `
        <div class="ocr-item ${l.presente ? 'on' : ''}">
          <img src="${l.imagem}" alt="linha ${i + 1} da foto">
          <div class="row nowrap">
            <label class="ocr-check"><input type="checkbox" name="ocrP" value="${i}" ${l.presente ? 'checked' : ''}> presente</label>
            <select name="ocrA">${opcoes(l.aluno)}</select>
          </div>
          <div class="muted small">lido: “${esc(l.texto.slice(0, 70))}”${l.aluno ? ` · ${Math.round(l.candidatos[0].score * 100)}% pela ${l.candidatos[0].via}` : l.duplicada ? ' · aluno já reconhecido em outra linha' : ''}${l.tinta != null ? ` · ${l.tinta > 0.06 ? 'com' : 'sem'} assinatura` : ''}</div>
        </div>`).join('')}</div>
      ${fora.length ? `<details ${tipo === 'impressa' ? 'open' : ''}><summary class="small"><b>${fora.length}</b> aluno(s) não encontrados na foto — marque quem estava presente</summary>
        <div class="checks" style="margin-top:8px">${fora.map(a => `<label><input type="checkbox" name="ocrExtra" value="${a.id}"> ${esc(nomeCurto(a.nome))}</label>`).join('')}</div></details>` : ''}
      <label class="checks" style="margin-top:12px"><label><input type="checkbox" name="demaisF" checked> marcar os demais como falta</label></label>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Aplicar na chamada</button></div>`,
    form => {
      // Escolher um aluno numa linha já marca "presente"; "ignorar" desmarca.
      form.querySelectorAll('.ocr-item').forEach(div => {
        const sel = div.querySelector('select'), chk = div.querySelector('input[type=checkbox]');
        sel.addEventListener('change', () => { chk.checked = !!sel.value; div.classList.toggle('on', chk.checked); });
        chk.addEventListener('change', () => div.classList.toggle('on', chk.checked));
      });
    });
    if (r.acao !== 'ok') return;
    const escolhidos = [].concat(r.dados.ocrA == null ? [] : r.dados.ocrA);
    const marcadas = new Set([].concat(r.dados.ocrP || []).map(Number));
    const presentes = new Set(escolhidos.filter((id, i) => id && marcadas.has(i)));
    [].concat(r.dados.ocrExtra || []).forEach(id => presentes.add(id));
    const m = t.presencas[aula.id] || (t.presencas[aula.id] = {});
    let nP = 0, nF = 0;
    presentes.forEach(id => { if (!m[id] || m[id] === 'F') { m[id] = 'P'; nP++; } });
    if (r.dados.demaisF) t.alunos.filter(a => a.ativo && !m[a.id]).forEach(a => { m[a.id] = 'F'; nF++; });
    salvar(); render();
    toast(`${nP} presença(s) e ${nF} falta(s) registradas`);
  }

  /* ---------- filtros e ordenação (Resumo, Alunos, Notas) ---------- */

  const visoes = {};
  function visaoDe(t) { return visoes[t.id] || (visoes[t.id] = { filtro: 'todos', ordem: 'nome', curso: '' }); }

  function barraVisao(t, total, lista) {
    const v = visaoDe(t);
    const cursosT = Array.from(new Set(CC.alunosOrdenados(t, false).map(a => cursoDe(t, a)).filter(Boolean))).sort();
    const sel = (id, obj, atual) => `<select id="${id}">${Object.keys(obj).map(k => `<option value="${k}" ${atual === k ? 'selected' : ''}>${obj[k].rotulo}</option>`).join('')}</select>`;
    return `<div class="card barra-visao"><div class="row nowrap">
      <label class="field grow">Mostrar${sel('v-filtro', CC.FILTROS, v.filtro)}</label>
      <label class="field grow">Ordenar por${sel('v-ordem', CC.ORDENS, v.ordem)}</label></div>
      ${cursosT.length > 1 ? `<label class="field" style="margin-top:6px">Curso<select id="v-curso"><option value="">Todos os cursos</option>${cursosT.map(c => `<option ${v.curso === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}
      <div class="row small muted" style="margin-top:8px"><span>${lista.length} de ${total} aluno(s)</span>
      <button class="btn small right" id="v-email" type="button" ${lista.length ? '' : 'disabled'}>✉ E-mail para estes</button></div></div>`;
  }

  function ligarBarraVisao(t, lista) {
    ['filtro', 'ordem', 'curso'].forEach(k => {
      const el = $('#v-' + k);
      if (el) el.onchange = () => { visaoDe(t)[k] = el.value; render(); };
    });
    const em = $('#v-email');
    if (em) em.onclick = () => enviarEmail(t, lista.map(x => x.a));
  }

  /* ---------- estatísticas de notas ---------- */

  function miniHist(h) {
    const mx = Math.max.apply(null, h) || 1;
    return `<span class="hist" title="Distribuição de 0 a 10">${h.map((c, k) => `<i style="height:${Math.max(4, Math.round(c / mx * 100))}%;${c ? '' : 'opacity:.25'}" title="${k} a ${k + 1}: ${c}"></i>`).join('')}</span>`;
  }

  function cartaoEstatisticas(t) {
    const e = CC.estatisticasNotas(t);
    if (!e.avaliacoes.some(x => x.n)) return '';
    const f = (x, casas) => x == null ? '—' : CC.numBR(x, casas == null ? 1 : casas);
    const s = e.situacao;
    return `<div class="card"><h3>Estatísticas</h3>
      <div class="muted small" style="margin-bottom:8px">${e.total} inscritos ·
        <span class="tag OK">${s.aprovados} com média suficiente</span>
        ${CC.avaliacaoTipo(t, 'VS') ? `<span class="tag VS">${s.vs} em VS</span>` : ''}
        <span class="tag BAIXA">${s.nota} abaixo da média</span>
        <span class="tag RF">${s.rf} reprovados por falta</span>
        ${s.semnota ? `<span class="tag fora">${s.semnota} sem notas</span>` : ''}</div>
      <div class="tabela-wrap" style="box-shadow:none"><table><thead><tr><th></th><th class="num">Notas</th><th class="num">Média</th><th class="num opc">Mediana</th><th class="num opc">Mín–máx</th><th class="num">≥ ${f(t.config.mediaMin)}</th><th>Distribuição</th></tr></thead><tbody>` +
      e.avaliacoes.map(x => `<tr${x.media_ ? ' class="linha-media"' : ''}><td><b>${esc(x.nome)}</b>${x.escala !== 10 ? ` <span class="muted small">/ ${x.escala}</span>` : ''}</td>
        <td class="num">${x.n}/${x.total}</td><td class="num">${f(x.media)}</td><td class="num opc">${f(x.mediana)}</td>
        <td class="num opc">${x.n ? f(x.min) + '–' + f(x.max) : '—'}</td><td class="num">${x.acima == null ? '—' : Math.round(x.acima * 100) + '%'}</td>
        <td>${x.n ? miniHist(x.hist) : ''}</td></tr>`).join('') +
      `</tbody></table></div><p class="muted small" style="margin:6px 0 0">Desvio padrão: ${e.avaliacoes.filter(x => x.n > 1).map(x => esc(x.nome) + ' ' + f(x.dp)).join(' · ') || '—'}</p></div>`;
  }

  /* ---------- e-mail (pelo app de e-mail do aparelho) ---------- */

  function copiar(texto, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject())
      .then(() => toast(msg || 'Copiado'), () => toast('Não consegui copiar'));
  }

  function mailto(para, bcc, assunto, corpo) {
    const q = [];
    if (bcc && bcc.length) q.push('bcc=' + encodeURIComponent(bcc.join(',')));
    q.push('subject=' + encodeURIComponent(assunto));
    q.push('body=' + encodeURIComponent(corpo));
    return 'mailto:' + encodeURIComponent(para || '') + '?' + q.join('&');
  }

  /**
   * Escreve e envia e-mail aos alunos. Aviso: mesma mensagem para todos, em cópia oculta.
   * Personalizado: uma mensagem por aluno, com {campos} preenchidos; cada uma abre no app de e-mail.
   */
  async function enviarEmail(t, lista) {
    const todos = CC.alunosOrdenados(t, false);
    const risco = todos.filter(a => { const c = CC.statsAluno(t, a).situacao.cod; return c === 'RF' || c === 'LIM'; });
    const grupos = [];
    if (lista && lista.length && lista.length !== todos.length) grupos.push(['lista', lista.length === 1 ? CC.titleCase(lista[0].nome) : `Os ${lista.length} alunos da lista atual`, lista]);
    grupos.push(['todos', `Todos os inscritos (${todos.length})`, todos]);
    if (risco.length) grupos.push(['risco', `Perto do limite ou reprovados por falta (${risco.length})`, risco]);
    const modelos = CC.MODELOS_EMAIL.concat(db.modelosEmail || []);
    const inicial = lista && lista.length === 1 ? modelos.find(m => m.id === 'resumo') : modelos[0];
    const campos = Object.keys(CC.CAMPOS_EMAIL).map(k => `<code>{${k}}</code> ${CC.CAMPOS_EMAIL[k]}`).join(' · ');
    const r = await dialogo(`<h2>Enviar e-mail</h2><div class="stack">
      <label class="field">Para<select name="grupo">${grupos.map(g => `<option value="${g[0]}">${esc(g[1])}</option>`).join('')}</select></label>
      <label class="field">Modelo<select name="modelo">${modelos.map(m => `<option value="${m.id}" ${m === inicial ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></label>
      <div class="checks"><label><input type="radio" name="tipo" value="aviso"> mesma mensagem para todos (cópia oculta)</label>
        <label><input type="radio" name="tipo" value="pessoal"> uma mensagem personalizada por aluno</label></div>
      <label class="field">Assunto<input type="text" name="assunto"></label>
      <label class="field">Mensagem<textarea name="corpo" rows="8"></textarea></label>
      <label class="field">Assinatura<textarea name="assinatura" rows="2" placeholder="ex.: Prof. Fulano — IC/UFF">${esc(db.assinatura || '')}</textarea></label>
      <details class="muted small"><summary>Campos que você pode usar na mensagem personalizada</summary><p>${campos}</p></details>
      <div class="row nowrap"><label class="checks"><label><input type="checkbox" name="salvar"> salvar como modelo</label></label>
        <input type="text" name="nomeModelo" placeholder="nome do modelo" class="grow"></div>
      </div>
      <div class="acoes"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Continuar</button></div>`,
    form => {
      const preencher = () => {
        const m = modelos.find(x => x.id === form.modelo.value);
        form.assunto.value = m.assunto; form.corpo.value = m.corpo;
        form.querySelector(`[name=tipo][value=${m.tipo}]`).checked = true;
      };
      form.modelo.addEventListener('change', preencher);
      preencher();
    });
    if (r.acao !== 'ok') return;
    const d = r.dados;
    db.assinatura = String(d.assinatura || '').trim();
    if (d.salvar) {
      (db.modelosEmail = db.modelosEmail || []).push({ id: CC.uid('m'), nome: String(d.nomeModelo || '').trim() || String(d.assunto).trim() || 'Modelo', tipo: d.tipo, assunto: d.assunto, corpo: d.corpo });
    }
    salvar();
    const alvo = grupos.find(g => g[0] === d.grupo)[2];
    const comEmail = alvo.filter(a => a.email), semEmail = alvo.filter(a => !a.email);
    const corpo = String(d.corpo).replace(/\s+$/, '') + (db.assinatura ? '\n\n' + db.assinatura : '');
    const avisoSem = semEmail.length ? `<p class="small" style="color:var(--A)">Sem e-mail cadastrado: ${semEmail.map(a => esc(nomeCurto(a.nome))).join(', ')}</p>` : '';
    if (!comEmail.length) return toast('Nenhum destinatário tem e-mail cadastrado');

    if (d.tipo === 'aviso') {
      const assunto = CC.preencherModelo(d.assunto, t, null), texto = CC.preencherModelo(corpo, t, null);
      // Endereços longos demais quebram alguns apps de e-mail: divide em partes.
      const partes = [];
      let atual = [];
      comEmail.forEach(a => {
        if (atual.length && mailto('', atual.concat(a.email), assunto, texto).length > 1900) { partes.push(atual); atual = []; }
        atual.push(a.email);
      });
      if (atual.length) partes.push(atual);
      await dialogo(`<h2>Aviso para ${comEmail.length} aluno(s)</h2>
        <p class="muted small">Os endereços vão em cópia oculta (um não vê o e-mail do outro).</p>
        <div class="stack">${partes.map((p, k) => `<a class="btn primary block" href="${mailto('', p, assunto, texto)}">Abrir no e-mail${partes.length > 1 ? ` — parte ${k + 1} de ${partes.length} (${p.length})` : ''}</a>`).join('')}
        <div class="row"><button class="btn small" type="button" id="cp-end">Copiar endereços</button><button class="btn small" type="button" id="cp-msg">Copiar mensagem</button></div></div>
        ${avisoSem}
        <div class="acoes"><button class="btn" value="">Fechar</button></div>`, form => {
        form.querySelector('#cp-end').onclick = () => copiar(comEmail.map(a => a.email).join(', '), 'Endereços copiados');
        form.querySelector('#cp-msg').onclick = () => copiar(assunto + '\n\n' + texto, 'Mensagem copiada');
      });
      return;
    }

    await dialogo(`<h2>Mensagens personalizadas</h2>
      <p class="muted small">Toque em "Enviar" em cada aluno: a mensagem dele abre no app de e-mail, já preenchida. Volte aqui para o próximo.</p>
      <div class="lista-chamada envio">${comEmail.map(a => {
        const texto = CC.preencherModelo(corpo, t, a);
        return `<div class="aluno-row"><div class="nome">${esc(nomeCurto(a.nome))}<div class="det">${esc(texto.split('\n').filter(Boolean)[1] || texto.split('\n')[0]).slice(0, 90)}</div></div>
          <a class="btn small" href="${mailto(a.email, null, CC.preencherModelo(d.assunto, t, a), texto)}" data-env>Enviar</a></div>`;
      }).join('')}</div>${avisoSem}
      <div class="acoes"><button class="btn" value="">Fechar</button></div>`, form => {
      form.querySelectorAll('[data-env]').forEach(a => a.addEventListener('click', () => {
        a.textContent = '✓ Enviado'; a.closest('.aluno-row').classList.add('enviado');
      }));
    });
  }

  /* ---------- pasta de trabalho ---------- */

  function nomeNavegador() {
    const ua = navigator.userAgent;
    if (/DuckDuckGo/i.test(ua)) return 'DuckDuckGo';
    if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
    if (/Firefox|FxiOS/i.test(ua)) return 'Firefox';
    if (/EdgA?\//i.test(ua)) return 'Edge';
    if (/OPR\//i.test(ua)) return 'Opera';
    if (/; wv\)/.test(ua)) return 'um navegador baseado no WebView do Android';
    if (/Chrome\//.test(ua)) return 'Chrome';
    return 'este navegador';
  }

  /**
   * O seletor de pasta/arquivo "cancelou". Se foi rápido demais para ter sido a pessoa, o
   * navegador não sabe mostrar o seletor (ex.: DuckDuckGo e outros apps baseados no WebView).
   */
  function seletorFalhou(e, inicio, oque) {
    const imediato = Date.now() - inicio < 1500;
    if (e.name === 'AbortError' && !imediato) return;          // a pessoa cancelou
    Pasta.marcarSemSeletor();
    const android = /Android/i.test(navigator.userAgent);
    dialogo(`<h2>O navegador não abriu ${esc(oque)}</h2>
      <p>${esc(nomeNavegador())} recusou o pedido${e.name !== 'AbortError' ? ` (${esc(e.message || e.name)})` : ''}. As opções de pasta de trabalho e "Salvar como…" não serão mais oferecidas neste navegador.</p>
      ${android ? `<p>No Android, use o app pelo <b>Chrome</b> (versão 132 ou mais nova): abra <b>${esc(location.origin + location.pathname)}</b> no Chrome e instale pelo menu ⋮ → <b>Instalar app</b>. Os dados ficam separados por navegador: faça um backup aqui (Menu → Salvar backup) e restaure lá.</p>` : '<p>Use o Chrome ou o Edge atualizados.</p>'}
      <p class="muted small">Enquanto isso, ao exportar use <b>Compartilhar</b> (Drive, e-mail…) ou <b>Baixar</b>.</p>
      <div class="acoes"><button class="btn primary" value="">Entendi</button></div>`);
  }

  async function configurarPasta(t, proj) {
    if (!Pasta.suportada) {
      return dialogo(`<h2>Pasta de trabalho</h2>
        <p>${esc(nomeNavegador())} não permite que o app escolha uma pasta.${/Android/i.test(navigator.userAgent) ? ' No Android, o Chrome (versão 132 ou mais nova) permite: abra o app nele e instale pelo menu ⋮ → Instalar app.' : ''}</p>
        <p class="muted small">Ao exportar, use <b>Compartilhar</b> para mandar ao Google Drive (ou outro app) ou <b>Baixar</b> para a pasta Downloads; ao importar, o seletor de arquivos do sistema abre em qualquer pasta. No computador (Chrome ou Edge), a pasta de trabalho funciona.</p>
        <div class="acoes"><button class="btn primary" value="">Fechar</button></div>`);
    }
    const k = proj ? 'p:' + proj.id : Pasta.chave(t);
    const atual = await Pasta.obter(k), geral = t || proj ? await Pasta.obter('global') : null;
    const r = await dialogo(`<h2>Pasta de trabalho${t ? ' da turma' : proj ? ' do projeto' : ''}</h2>
      <p>${atual ? `Atual: <b>${esc(atual.name)}</b>` : t || proj ? `Usa a pasta ${t ? 'do projeto ou a ' : ''}geral${geral ? `: <b>${esc(geral.name)}</b>` : ' (nenhuma escolhida)'}.` : 'Nenhuma pasta escolhida.'}</p>
      <p class="muted small">${proj ? 'As planilhas das turmas do projeto são salvas na pasta da disciplina (padrão UFF-código-sigla, como em LK-UFF-aulas), com o nome no mesmo padrão.'
        : t ? 'Exportações, backups e importações desta turma usam esta pasta; sem ela, vale a do projeto ou a geral.' : 'Exportações, backups e importações usam esta pasta (cada projeto e cada turma podem ter a sua).'}
      O navegador pode pedir permissão para editar arquivos nela.</p>
      <div class="acoes">${atual ? '<button class="btn danger" value="esquecer">Esquecer</button>' : ''}
      <button class="btn" value="">Fechar</button><button class="btn primary" value="escolher">${atual ? 'Trocar pasta…' : 'Escolher pasta…'}</button></div>`);
    if (r.acao === 'esquecer') { await Pasta.esquecer(k); return toast('Pasta esquecida'); }
    if (r.acao !== 'escolher') return;
    const inicio = Date.now();
    try { const h = await Pasta.escolher(k); toast('Pasta de trabalho: ' + h.name); }
    catch (e) { seletorFalhou(e, inicio, 'a lista de pastas'); }
  }

  /* ---------- arquivar turma ---------- */

  function alternarArquivo(t) {
    t.arquivada = t.arquivada ? null : CC.todayISO();
    salvar();
    toast(t.arquivada ? 'Turma arquivada (continua em "Turmas arquivadas")' : 'Turma restaurada');
    go('#/');
  }

  /* ---------- várias chamadas no mesmo dia ---------- */

  function outraChamada(t, aula) {
    const n = t.aulas.filter(a => a.data === aula.data).length;
    const nova = CC.aulaDaData(t, aula.data, n, true);
    salvar();
    toast(`${n + 1}ª chamada de ${CC.fmtDate(aula.data)} — cada chamada conta como uma aula`);
    go(`#/t/${t.id}/chamada/${nova.id}`);
  }

  function rotuloChamada(t, aula) {
    const doDia = CC.aulasOrdenadas(t).filter(a => a.data === aula.data);
    return doDia.length > 1 ? ` · ${doDia.indexOf(aula) + 1}ª chamada` : '';
  }

  /* ---------- tela: chamada ---------- */

  let modoUmAUm = false;
  let idxUmAUm = 0;

  function aulaPadrao(t) {
    const hoje = CC.todayISO();
    const aulas = CC.aulasOrdenadas(t).filter(a => a.tipo !== 'sem-aula');
    return aulas.find(a => a.data === hoje)
      || aulas.filter(a => a.data < hoje).pop()
      || aulas[0] || null;
  }

  function telaChamada(t, aulaId) {
    const aulas = CC.aulasOrdenadas(t).filter(a => a.tipo !== 'sem-aula');
    const aula = (aulaId && aulas.find(a => a.id === aulaId)) || aulaPadrao(t);
    const hoje = CC.todayISO();
    const temHoje = aulas.some(a => a.data === hoje);

    if (!t.alunos.length) {
      app.innerHTML = `<div class="card empty"><p>Esta turma ainda não tem alunos.</p>
        <a class="btn primary" href="#/t/${t.id}/alunos">Adicionar alunos</a></div>`;
      return;
    }
    if (!aula) {
      app.innerHTML = `<div class="card empty"><p>Nenhuma aula cadastrada.</p>
        <div class="stack"><button class="btn primary block" id="hoje">Fazer chamada de hoje (${CC.fmtDate(hoje, true)})</button>
        <a class="btn block" href="#/t/${t.id}/cronograma">Montar cronograma</a></div></div>`;
      $('#hoje').onclick = () => criarAulaHoje(t);
      return;
    }

    const i = aulas.indexOf(aula);
    const marc = t.presencas[aula.id] || {};
    const obs = t.obs[aula.id] || {};
    const alunos = CC.alunosOrdenados(t, false);
    const inativosMarcados = CC.alunosOrdenados(t, true).filter(a => !a.ativo && marc[a.id]);
    const c = CC.contarAula(t, aula);

    let h = `<div class="card">
      <div class="aula-nav">
        <button class="icon-btn" id="ant" ${i <= 0 ? 'disabled' : ''} aria-label="Aula anterior" style="color:var(--text)">&#8249;</button>
        <div class="info" id="info-aula" style="cursor:pointer">
          <div class="data">${CC.fmtDate(aula.data, true)}${aula.data === hoje ? ' · hoje' : ''}${rotuloChamada(t, aula)}${aula.categoria ? ' · ' + esc(aula.categoria) : ''}</div>
          <div class="conteudo">${esc(aula.conteudo || 'Aula ' + (i + 1) + ' de ' + aulas.length)}</div>
        </div>
        <button class="icon-btn" id="prox" ${i >= aulas.length - 1 ? 'disabled' : ''} aria-label="Próxima aula" style="color:var(--text)">&#8250;</button>
      </div>
      <div class="contadores">
        <span class="c-P">${c.P} P</span><span class="c-A">${c.A} A</span><span class="c-J">${c.J} J</span><span class="c-F">${c.F} F</span><span class="c-vazio">${c.vazio} –</span>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn small" id="modo">${modoUmAUm ? '☰ Lista' : '▶ Um a um'}</button>
        <button class="btn small" id="todos-p">Todos presentes</button><button class="btn small" id="todos-f">Todos ausentes</button>
        <button class="btn small" id="ler-folha" title="Ler a folha de presença assinada pelos alunos">📷 Ler folha</button>
        <button class="btn small" id="extra" title="Aula dupla, reposição ou segunda chamada no mesmo dia">+ Outra chamada neste dia</button>
        ${!temHoje ? `<button class="btn small right" id="hoje">+ Hoje</button>` : ''}
      </div></div>`;

    if (modoUmAUm) {
      if (idxUmAUm >= alunos.length) idxUmAUm = 0;
      const a = alunos[idxUmAUm];
      const v = marc[a.id];
      h += `<div class="card um-a-um">
        <div class="progresso">${idxUmAUm + 1} de ${alunos.length}</div>
        <div class="nome-grande">${esc(nomeCurto(a.nome))}</div>
        <div class="mat">${esc(a.matricula)}</div>
        <div class="small" style="margin-top:6px">${textoFaltas(t, a)}</div>
        <div class="grandes">
          ${['P', 'A', 'J', 'F'].map(s => `<button class="${s} ${v === s ? 'on' : ''}" data-um="${s}">${CC.STATUS_LABEL[s]}</button>`).join('')}
        </div>
        <div class="row" style="margin-top:16px;justify-content:space-between">
          <button class="btn" id="um-ant" ${idxUmAUm === 0 ? 'disabled' : ''}>‹ Anterior</button>
          <button class="btn" id="um-obs">${obs[a.id] ? '✎ Obs.' : '+ Obs.'}</button>
          <button class="btn" id="um-prox">Próximo ›</button>
        </div></div>`;
    } else {
      h += `<div class="card" style="padding:8px"><input type="search" id="busca" placeholder="Buscar aluno…" autocomplete="off"></div>
        <div class="lista-chamada" id="lista">` +
        alunos.concat(inativosMarcados).map(a => linhaChamada(t, a, marc[a.id], obs[a.id])).join('') + '</div>';
    }
    app.innerHTML = h;

    $('#ant').onclick = () => go(`#/t/${t.id}/chamada/${aulas[i - 1].id}`);
    $('#prox').onclick = () => go(`#/t/${t.id}/chamada/${aulas[i + 1].id}`);
    $('#info-aula').onclick = () => editarAula(t, aula);
    $('#modo').onclick = () => { modoUmAUm = !modoUmAUm; idxUmAUm = primeiroVazio(alunos, marc); render(); };
    const hb = $('#hoje'); if (hb) hb.onclick = () => criarAulaHoje(t);
    $('#extra').onclick = () => outraChamada(t, aula);
    $('#todos-p').onclick = () => marcarTodos(t, aula, 'P');
    $('#todos-f').onclick = () => marcarTodos(t, aula, 'F');
    $('#ler-folha').onclick = () => lerFolhaPresenca(t, aula);

    if (modoUmAUm) {
      const a = alunos[idxUmAUm];
      app.querySelectorAll('[data-um]').forEach(b => b.onclick = () => {
        marcar(t, aula, a.id, b.dataset.um, true);
        if (b.dataset.um === 'J' && !obs[a.id]) {
          editarObs(t, aula, a).then(() => { idxUmAUm = Math.min(idxUmAUm + 1, alunos.length - 1); render(); });
          return;
        }
        if (idxUmAUm < alunos.length - 1) idxUmAUm++;
        else toast('Fim da lista');
        render();
      });
      $('#um-ant').onclick = () => { idxUmAUm--; render(); };
      $('#um-prox').onclick = () => { idxUmAUm = Math.min(idxUmAUm + 1, alunos.length - 1); render(); };
      $('#um-obs').onclick = () => editarObs(t, aula, a).then(render);
    } else {
      const lista = $('#lista');
      lista.addEventListener('click', ev => {
        const b = ev.target.closest('[data-st]');
        if (b) {
          const row = b.closest('.aluno-row');
          const atual = (t.presencas[aula.id] || {})[row.dataset.id];
          const novo = atual === b.dataset.st ? null : b.dataset.st;
          marcar(t, aula, row.dataset.id, novo, false);
          const nova = atualizarLinha(t, aula, row);
          if (novo === 'J') {
            const a = t.alunos.find(x => x.id === nova.dataset.id);
            if (!(t.obs[aula.id] || {})[a.id]) editarObs(t, aula, a).then(() => atualizarLinha(t, aula, nova));
          }
          return;
        }
        const n = ev.target.closest('.nome');
        if (n) {
          const a = t.alunos.find(x => x.id === n.closest('.aluno-row').dataset.id);
          menuAlunoAula(t, aula, a, n.closest('.aluno-row'));
        }
      });
      $('#busca').addEventListener('input', ev => {
        const q = CC.norm(ev.target.value);
        lista.querySelectorAll('.aluno-row').forEach(r => { r.hidden = q && !r.dataset.busca.includes(q); });
      });
    }
  }

  function primeiroVazio(alunos, marc) {
    const k = alunos.findIndex(a => !marc[a.id]);
    return k < 0 ? 0 : k;
  }

  /** "3 faltas" colorido: vermelho acima do limite, laranja perto dele. */
  function textoFaltas(t, a) {
    const st = CC.statsAluno(t, a);
    const cod = st.situacao.cod === 'RF' || st.situacao.cod === 'LIM' ? st.situacao.cod : '';
    return `<span class="faltas-n ${cod}" title="${esc(st.situacao.texto || 'Faltas até agora')}">${CC.numBR(st.faltas, st.faltas % 1 ? 1 : 0)} falta${st.faltas === 1 ? '' : 's'}</span>`;
  }

  function linhaChamada(t, a, v, obs) {
    return `<div class="aluno-row ${a.ativo ? '' : 'inativo'}" data-id="${a.id}" data-busca="${esc(CC.norm(a.nome + ' ' + a.matricula))}">
      <div class="nome">${esc(nomeCurto(a.nome))}${obs ? ' <span class="obs-dot" title="Observação">●</span>' : ''}
        <div class="det">${textoFaltas(t, a)} · ${esc(a.matricula)}${cursoDe(t, a) ? ' · ' + esc(cursoDe(t, a)) : ''}${a.ativo ? '' : ' · fora da lista'}</div></div>
      <div class="st-group">${['P', 'A', 'J', 'F'].map(s => `<button class="st ${s} ${v === s ? 'on' : ''}" data-st="${s}" aria-label="${CC.STATUS_LABEL[s]}">${s}</button>`).join('')}</div>
    </div>`;
  }

  function atualizarLinha(t, aula, row) {
    const a = t.alunos.find(x => x.id === row.dataset.id);
    const tmp = document.createElement('div');
    tmp.innerHTML = linhaChamada(t, a, (t.presencas[aula.id] || {})[a.id], (t.obs[aula.id] || {})[a.id]);
    const nova = tmp.firstElementChild;
    nova.hidden = row.hidden;
    row.replaceWith(nova);
    atualizarContadores(t, aula);
    return nova;
  }

  function atualizarContadores(t, aula) {
    const c = CC.contarAula(t, aula);
    const el = app.querySelector('.contadores');
    if (el) el.innerHTML = `<span class="c-P">${c.P} P</span><span class="c-A">${c.A} A</span><span class="c-J">${c.J} J</span><span class="c-F">${c.F} F</span><span class="c-vazio">${c.vazio} –</span>`;
  }

  function marcar(t, aula, alunoId, status) {
    const m = t.presencas[aula.id] || (t.presencas[aula.id] = {});
    if (status) m[alunoId] = status; else delete m[alunoId];
    if (navigator.vibrate) navigator.vibrate(12);
    salvar();
  }

  /** Marca todos os inscritos; se já houver outras marcações, pergunta se sobrescreve. */
  async function marcarTodos(t, aula, status) {
    const m = t.presencas[aula.id] || (t.presencas[aula.id] = {});
    const ativos = t.alunos.filter(a => a.ativo);
    const vazios = ativos.filter(a => !m[a.id]);
    const outros = ativos.filter(a => m[a.id] && m[a.id] !== status);
    const rotulo = status === 'P' ? 'presentes' : 'ausentes (falta)';
    let alvo = ativos;
    if (outros.length) {
      const r = await dialogo(`<h2>Marcar todos como ${rotulo}</h2>
        <p>${outros.length} aluno(s) já têm outra marcação nesta aula${vazios.length ? ` e ${vazios.length} ainda não foram marcados` : ''}.</p>
        <div class="acoes"><button class="btn" value="">Cancelar</button>
        ${vazios.length ? '<button class="btn" value="vazios">Só os não marcados</button>' : ''}
        <button class="btn primary" value="todos">Todos (sobrescrever)</button></div>`);
      if (r.acao === 'vazios') alvo = vazios;
      else if (r.acao !== 'todos') return;
    }
    alvo.forEach(a => { m[a.id] = status; });
    salvar(); render();
    toast(`${alvo.length} marcado(s) como ${rotulo}`);
  }

  function criarAulaHoje(t) {
    const aula = CC.aulaDaData(t, CC.todayISO(), 0, true);
    salvar();
    go(`#/t/${t.id}/chamada/${aula.id}`);
  }

  async function editarObs(t, aula, a) {
    const atual = (t.obs[aula.id] || {})[a.id] || '';
    const r = await dialogo(`<h2>Observação</h2><p class="muted">${esc(nomeCurto(a.nome))} · ${CC.fmtDate(aula.data, true)}</p>
      <textarea name="obs" autofocus placeholder="ex.: atestado médico">${esc(atual)}</textarea>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao !== 'ok') return;
    const m = t.obs[aula.id] || (t.obs[aula.id] = {});
    const txt = String(r.dados.obs || '').trim();
    if (txt) m[a.id] = txt; else delete m[a.id];
    salvar();
  }

  async function menuAlunoAula(t, aula, a, row) {
    const obs = (t.obs[aula.id] || {})[a.id];
    const st = CC.statsAluno(t, a);
    const r = await dialogo(`<h2>${esc(nomeCurto(a.nome))}</h2>
      <p class="muted small">${esc(a.matricula)} · ${CC.numBR(st.faltas)} falta(s) de ${limTxt(t)} permitidas${st.situacao.cod === 'RF' ? ' · <b style="color:var(--F)">reprovado por falta</b>' : ''}</p>
      ${obs ? `<p>Obs. (${CC.fmtDate(aula.data)}): ${esc(obs)}</p>` : ''}
      <ul class="menu-list">
      <li><button value="obs">${obs ? 'Editar' : 'Adicionar'} observação desta aula</button></li>
      <li><button value="hist">Ver histórico do aluno</button></li></ul>
      <div class="acoes"><button class="btn" value="">Fechar</button></div>`);
    if (r.acao === 'obs') { await editarObs(t, aula, a); atualizarLinha(t, aula, row); }
    if (r.acao === 'hist') go(`#/t/${t.id}/aluno/${a.id}`);
  }

  /* ---------- tela: alunos ---------- */

  /** Aluno avulso numa disciplina que não aceita avulsos ("Tópicos especiais…"). */
  function avulsoProibido(t, a) {
    return !!t.semAvulsos && CC.vinculoAluno(t, a) === 'A';
  }

  function telaAlunos(t) {
    const todos = CC.alunosOrdenados(t, true);
    const ativos = todos.filter(a => a.ativo).length;
    const v = Object.assign({}, visaoDe(t), { inativos: true });
    const lista = CC.alunosVisao(t, v, a => cursoDe(t, a));
    let h = `<div class="card"><div class="row"><div class="grow">
      <b>${ativos}</b> inscritos${todos.length > ativos ? ` · <span class="muted">${todos.length - ativos} fora da lista</span>` : ''}
      <div class="muted small">${t.listaEm ? 'Lista oficial atualizada em ' + CC.fmtDate(t.listaEm) : 'Lista oficial ainda não importada'}</div>
      <div class="muted small">${CC.ehUFF(t) ? resumoCursos(t, todos.filter(a => a.ativo)) : ""}</div></div>
      <button class="btn small" id="atualizar">Atualizar lista</button></div></div>`;
    if (!todos.length) {
      h += `<div class="card empty">Sem alunos. Importe a lista do sistema ou adicione à mão.</div>`;
    } else {
      h += barraVisao(t, todos.length, lista);
      h += `<div class="lista-chamada">` + (lista.length ? lista.map(({ a, st }) => `<div class="aluno-row ${a.ativo ? '' : 'inativo'}" data-id="${a.id}">
          <div class="nome">${esc(nomeCurto(a.nome))}
          <div class="det">${esc(a.matricula || 'sem matrícula')}${cursoDe(t, a) ? ' · ' + esc(cursoDe(t, a)) : ''}${avulsoProibido(t, a) ? ' · <span class="tag BAIXA">avulso não permitido</span>' : ''}${a.ativo ? '' : ' · fora da lista' + (a.saiuEm ? ' (' + esc(a.saiuEm.includes('-') ? CC.fmtDate(a.saiuEm) : a.saiuEm) + ')' : '')}${a.origem === 'manual' ? ' · incluído à mão' : ''}</div></div>
          <div class="right small num">${CC.numBR(st.faltas)} F${st.media != null ? ' · ' + CC.numBR(st.mf != null ? st.mf : st.media) : ''}${st.sitNota.cod ? ` <span class="tag ${st.sitNota.cod}">${{ RF: 'RF', OK: 'OK', VS: 'VS', BAIXA: '↓' }[st.sitNota.cod]}</span>` : ''}</div></div>`).join('')
        : '<div class="empty">Nenhum aluno neste filtro.</div>') + '</div>';
    }
    h += `<button class="fab" id="add">+ Aluno</button>`;
    app.innerHTML = h;
    $('#atualizar').onclick = () => atualizarLista(t);
    $('#add').onclick = () => editarAluno(t, null);
    if (todos.length) ligarBarraVisao(t, lista.filter(x => x.a.ativo));
    app.querySelectorAll('.aluno-row').forEach(r => r.onclick = () => go(`#/t/${t.id}/aluno/${r.dataset.id}`));
  }

  async function editarAluno(t, a) {
    const novo = !a;
    a = a || { nome: '', matricula: '', email: '', cpf: '' };
    const r = await dialogo(`<h2>${novo ? 'Novo aluno' : 'Editar aluno'}</h2><div class="stack">
      <label class="field">Nome<input type="text" name="nome" value="${esc(a.nome)}" required autofocus></label>
      <label class="field">Matrícula<input type="text" name="matricula" value="${esc(a.matricula)}" placeholder="graduação: 9 dígitos · pós: M048.126.009 ou CPF"></label>
      <label class="field">Vínculo<select name="vinculo"><option value="">Pela matrícula${(v => v ? ' (' + CC.VINCULOS[v] + ')' : '')(novo ? '' : CC.vinculoAluno(t, Object.assign({}, a, { vinculo: '' })))}</option>
        ${Object.keys(CC.VINCULOS).map(k => `<option value="${k}" ${a.vinculo === k ? 'selected' : ''}>${CC.VINCULOS[k]}</option>`).join('')}</select></label>
      <label class="field">E-mail<input type="text" name="email" inputmode="email" value="${esc(a.email)}"></label>
      ${novo ? '' : `<label class="checks"><label><input type="checkbox" name="ativo" ${a.ativo ? 'checked' : ''}> inscrito (aparece na chamada)</label></label>`}
      </div>
      <div class="acoes">${novo ? '' : '<button class="btn danger" value="remover" formnovalidate>Remover</button>'}
      <button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao === 'remover') {
      const ok = await confirmar('Remover aluno', `Remover <b>${esc(a.nome)}</b> e todo o histórico de presença e notas? Para só tirá-lo da chamada, desmarque "inscrito".`, 'Remover', true);
      if (ok) { CC.removerAluno(t, a.id); salvar(); go(`#/t/${t.id}/alunos`); }
      return;
    }
    if (r.acao !== 'ok') return;
    const nome = r.dados.nome.trim();
    if (!nome) return;
    const mat = r.dados.matricula.trim();
    if (mat && t.alunos.some(x => x !== a && x.matricula === mat)) return toast('Já existe aluno com essa matrícula');
    if (novo) {
      t.alunos.push({ id: CC.uid('a'), nome, matricula: mat, email: r.dados.email.trim(), cpf: '', vinculo: r.dados.vinculo || '', origem: 'manual', ativo: true, entrouEm: CC.todayISO(), saiuEm: null });
    } else {
      a.nome = nome; a.matricula = mat; a.email = r.dados.email.trim();
      if (r.dados.vinculo) a.vinculo = r.dados.vinculo; else delete a.vinculo;
      const ativo = !!r.dados.ativo;
      if (a.ativo && !ativo) a.saiuEm = CC.todayISO();
      if (ativo) a.saiuEm = null;
      a.ativo = ativo;
    }
    salvar(); render();
  }

  function telaAluno(t, alunoId) {
    const a = t.alunos.find(x => x.id === alunoId);
    if (!a) return go(`#/t/${t.id}/alunos`);
    const st = CC.statsAluno(t, a);
    const aulas = CC.aulasOrdenadas(t).filter(x => CC.aulaRealizada(t, x));
    let h = `<div class="card"><div class="row nowrap"><div class="grow">
      <h2>${esc(nomeCurto(a.nome))}</h2>
      <div class="muted small">${esc(a.matricula)}${a.email ? ' · ' + esc(a.email) : ''}</div>
      ${(i => cursoDe(t, a) ? `<div class="small">${esc(cursoDe(t, a))}${i ? ` <span class="muted">· ${i.nivel === 'grad' ? 'ingresso ' : ''}${esc(i.ingresso)}</span>` : ''}</div>` : '')(CC.infoMatricula(a.matricula, cursos(t)))}
      ${a.ativo ? '' : '<span class="tag fora">fora da lista</span>'}${avulsoProibido(t, a) ? ' <span class="tag BAIXA">avulso: a disciplina não aceita</span>' : ''}</div>
      <div class="stack" style="flex:none"><button class="btn small" id="editar">Editar</button>${a.email ? '<button class="btn small" id="mail-aluno">✉ E-mail</button>' : ''}</div></div>
      <div class="contadores"><span class="c-P">${st.P} P</span><span class="c-A">${st.A} A</span><span class="c-J">${st.J} J</span><span class="c-F">${st.F} F</span></div>
      <p class="small" style="margin:10px 0 0">Faltas: <b>${CC.numBR(st.faltas)}</b> de ${limTxt(t)} permitidas
      ${st.freq != null ? ' · frequência ' + Math.round(st.freq * 100) + '%' : ''}
      ${st.media != null ? ' · média ' + CC.numBR(st.media) : ''}${CC.avaliacaoTipo(t, 'VS') && st.mf != null && st.mf !== st.media ? ' · MF ' + CC.numBR(st.mf) : ''}
      ${st.situacao.texto ? ` <span class="tag ${st.situacao.cod}">${st.situacao.texto}</span>` : ''}</p>
      ${Object.keys(st.porCategoria).length > 1 ? `<p class="small muted" style="margin:6px 0 0">${Object.keys(st.porCategoria).sort().map(k => {
        const x = st.porCategoria[k];
        return `${esc(k)}: ${CC.numBR(x.faltas, x.faltas % 1 ? 1 : 0)} falta(s) em ${x.aulas} aula(s)`;
      }).join(' · ')}</p>` : ''}</div>`;
    const hist = CC.historicoAluno(db.turmas, t, a);
    if (hist.length) {
      h += `<div class="card"><h3>Em outras turmas</h3>` + hist.map(({ t: u, a: b }) => {
        const s = CC.statsAluno(u, b);
        const sit = !b.ativo ? 'fora da lista' : (s.sitNota.texto || (s.registradas ? 'frequência ' + Math.round(s.freq * 100) + '%' : ''));
        return `<a class="row small hist" href="#/t/${u.id}/aluno/${b.id}"><span class="grow">${esc(CC.periodoCurto(u.periodo))} · ${esc(CC.disciplinaTema(u))}${u.turma ? ' (' + esc(u.turma) + ')' : ''}</span>
          <span class="muted">${esc(sit)}${s.mf != null ? ' · MF ' + CC.numBR(s.mf) : ''}</span></a>`;
      }).join('') + '</div>';
    }
    if (t.avaliacoes.length) {
      h += `<div class="card"><h3>Notas</h3>` + t.avaliacoes.map(v => {
        const n = (t.notas[v.id] || {})[a.id];
        const d = v.detalhe && v.detalhe.alunos[a.id];
        const linha = `<div class="row small"><span class="grow">${esc(v.nome)}${d && d.modelo ? ` <span class="muted">· modelo ${esc(d.modelo)}</span>` : ''}${d && d.situacao === 'Ausente' ? ' <span class="muted">· ausente</span>' : ''}</span><b>${typeof n === 'number' ? CC.numBR(n, n % 1 ? (Math.round(n * 10) === n * 10 ? 1 : 2) : 0) : '—'}</b><span class="muted">/ ${v.max}</span></div>`;
        if (!d || d.situacao === 'Ausente') return linha;
        const txts = Object.keys(d.textos || {});
        return linha + `<div class="muted small" style="margin:-2px 0 6px 10px">${v.detalhe.questoes.map(q => `${esc(q.nome)} ${nb(CC.totalQuestao(v.detalhe, a.id, q))}/${nb(CC.maxQuestao(q))}`).join(' · ')}
          ${Object.keys(d.extras || {}).map(k => ` · ${esc(k)}: ${esc(d.extras[k])}`).join('')}</div>
          ${txts.length ? `<details class="small" style="margin:0 0 8px 10px"><summary>Correção comentada</summary>${txts.map(k => `<p style="margin:4px 0"><b>${esc(k)}:</b> ${esc(d.textos[k])}</p>`).join('')}</details>` : ''}`;
      }).join('') + '</div>';
    }
    h += `<div class="lista-chamada">` + (aulas.length ? aulas.map(aula => {
      const v = (t.presencas[aula.id] || {})[a.id];
      const o = (t.obs[aula.id] || {})[a.id];
      return `<div class="aula-item" data-aula="${aula.id}"><div class="quando">${CC.fmtDate(aula.data)}<div class="dia">${CC.DIAS[CC.weekday(aula.data)]}${rotuloChamada(t, aula).replace(' · ', ' · ').replace(' chamada', '')}</div></div>
        <div class="grow small">${esc(aula.conteudo || '')}${o ? `<div class="muted">Obs.: ${esc(o)}</div>` : ''}</div>
        ${v ? `<span class="mini ${v}">${v}</span>` : '<span class="mini">–</span>'}</div>`;
    }).join('') : '<div class="empty">Nenhuma chamada feita ainda.</div>') + '</div>';
    app.innerHTML = h;
    setTopo(nomeCurto(a.nome), CC.nomeTurma(t), `#/t/${t.id}/alunos`, () => menuTurma(t));
    $('#editar').onclick = () => editarAluno(t, a);
    const ma = $('#mail-aluno'); if (ma) ma.onclick = () => enviarEmail(t, [a]);
    app.querySelectorAll('[data-aula]').forEach(el => el.onclick = () => go(`#/t/${t.id}/chamada/${el.dataset.aula}`));
  }

  /* ---------- tela: cronograma ---------- */

  function telaCronograma(t) {
    const aulas = CC.aulasOrdenadas(t);
    const hoje = CC.todayISO();
    const cal = CC.calendarioDe(db, t), pendCal = cal ? feriadosPendentes(t, cal) : 0;
    let h = `<div class="card"><div class="row"><div class="grow"><b>${CC.aulasPrevistas(t)}</b> aulas previstas
      <div class="muted small">${aulas.filter(a => CC.aulaRealizada(t, a)).length} com chamada · máximo de ${limTxt(t)} faltas</div>
      ${cal ? `<div class="muted small">Calendário letivo ${esc(CC.chavePeriodo(t.periodo))}: ${esc(resumoCalendario(cal))}</div>` : ''}</div>
      <button class="btn small" id="gerar">Gerar datas</button></div>
      ${pendCal ? `<button class="btn small" id="aplicar-cal" style="margin-top:8px">Marcar ${pendCal} aula(s) em feriado como "Sem aula"</button>` : ''}</div>`;
    h += `<div class="lista-chamada">` + (aulas.length ? aulas.map(aula => {
      const feita = CC.aulaRealizada(t, aula);
      const c = feita ? CC.contarAula(t, aula) : null;
      return `<div class="aula-item ${aula.data === hoje ? 'hoje' : ''} ${aula.tipo}" data-id="${aula.id}">
        <div class="quando">${CC.fmtDate(aula.data)}<div class="dia">${CC.DIAS[CC.weekday(aula.data)]}${rotuloChamada(t, aula).replace(' · ', ' · ').replace(' chamada', '')}</div></div>
        <div class="grow"><div>${esc(aula.conteudo || (aula.tipo === 'aula' ? '' : CC.TIPOS[aula.tipo]))}</div>
        <div class="badge">${aula.categoria && aula.tipo !== 'sem-aula' ? `<span class="tag cat">${esc(aula.categoria)}</span> ` : ''}${aula.tipo !== 'aula' ? CC.TIPOS[aula.tipo] : ''}${feita ? (aula.tipo !== 'aula' ? ' · ' : '') + c.P + ' P · ' + c.A + ' A · ' + c.J + ' J · ' + c.F + ' F' : ''}</div></div>
        ${aula.tipo !== 'sem-aula' ? `<button class="btn small" data-chamada="${aula.id}">${feita ? 'Ver' : 'Chamada'}</button>` : ''}</div>`;
    }).join('') : '<div class="empty">Nenhuma aula. Use "Gerar datas" ou adicione uma por uma.</div>') + '</div>';
    h += `<button class="fab" id="add">+ Aula</button>`;
    app.innerHTML = h;
    $('#gerar').onclick = () => gerarDatas(t);
    if (pendCal) $('#aplicar-cal').onclick = () => { const n = CC.aplicarCalendario(t, cal); salvar(); render(); toast(n + ' aula(s) marcada(s) como "Sem aula"'); };
    $('#add').onclick = () => editarAula(t, null);
    app.querySelectorAll('.aula-item').forEach(el => el.onclick = ev => {
      const b = ev.target.closest('[data-chamada]');
      if (b) return go(`#/t/${t.id}/chamada/${b.dataset.chamada}`);
      editarAula(t, t.aulas.find(a => a.id === el.dataset.id));
    });
  }

  async function gerarDatas(t) {
    const aulas = CC.aulasOrdenadas(t);
    const c = t.config, cal = CC.calendarioDe(db, t);
    const ini = c.inicio || (cal && cal.inicio) || (aulas.length ? aulas[0].data : CC.todayISO());
    const fim = c.fim || (cal && cal.fim) || (aulas.length ? aulas[aulas.length - 1].data : CC.addDays(CC.todayISO(), 120));
    const diasUsados = new Set(c.dias && c.dias.length ? c.dias : aulas.map(a => CC.weekday(a.data)));
    const r = await dialogo(`<h2>Gerar datas de aula</h2><div class="stack">
      <div class="row nowrap"><label class="field grow">De<input type="date" name="ini" value="${ini}" required></label>
      <label class="field grow">Até<input type="date" name="fim" value="${fim}" required></label></div>
      <div class="checks">${[1, 2, 3, 4, 5, 6].map(d => `<label><input type="checkbox" name="dia" value="${d}" ${diasUsados.has(d) ? 'checked' : ''}> ${CC.DIAS[d]}</label>`).join('')}</div>
      <p class="muted small">Datas que já existem não são duplicadas. ${cal ? `Os dias sem aula do calendário letivo (${(cal.eventos || []).filter(e => e.semAula).length}) entram como "Sem aula".` : 'Depois marque feriados como "Sem aula" (ou preencha o calendário letivo do projeto).'}</p></div>
      <div class="acoes"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Gerar</button></div>`);
    if (r.acao !== 'ok') return;
    const dias = [].concat(r.dados.dia || []).map(Number);
    if (!dias.length) return toast('Escolha ao menos um dia da semana');
    const n = CC.gerarCronograma(t, r.dados.ini, r.dados.fim, dias, cal);
    Object.assign(c, { inicio: r.dados.ini, fim: r.dados.fim, dias });
    salvar(); render();
    toast(n + ' aula(s) adicionada(s)');
  }

  async function editarAula(t, aula) {
    const nova = !aula;
    const a = aula || { data: CC.todayISO(), conteudo: '', tipo: 'aula' };
    const cats = t.config.categorias || [];
    const r = await dialogo(`<h2>${nova ? 'Nova aula' : 'Aula'}</h2><div class="stack">
      <label class="field">Data<input type="date" name="data" value="${a.data}" required></label>
      <label class="field">Tipo<select name="tipo">${Object.keys(CC.TIPOS).map(k => `<option value="${k}" ${a.tipo === k ? 'selected' : ''}>${CC.TIPOS[k]}</option>`).join('')}</select></label>
      <label class="field">Conteúdo / observação<input type="text" name="conteudo" value="${esc(a.conteudo)}" placeholder="ex.: Autômatos finitos; Feriado; P1"></label>
      ${cats.length ? `<label class="field">Tipo de aula<select name="categoria"><option value="">— (pelo dia da semana)</option>
        ${cats.map(c => `<option ${a.categoriaFixa && a.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}
      </div>
      <div class="acoes">${nova ? '' : '<button class="btn danger" value="remover" formnovalidate>Excluir</button><button class="btn" value="presenca" formnovalidate>Lista de presença</button>'}
      <button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao === 'presenca') return listaPresenca(t, aula);
    if (r.acao === 'remover') {
      const temChamada = CC.aulaRealizada(t, aula);
      const ok = !temChamada || await confirmar('Excluir aula', `A aula de ${CC.fmtDate(aula.data)} tem chamada registrada. Excluir mesmo assim?`, 'Excluir', true);
      if (ok) { CC.removerAula(t, aula.id); salvar(); render(); }
      return;
    }
    if (r.acao !== 'ok' || !r.dados.data) return;
    let alvo = aula;
    if (nova) {
      const doDia = t.aulas.filter(x => x.data === r.dados.data).length;
      alvo = { id: CC.uid('d'), data: r.dados.data, conteudo: r.dados.conteudo.trim(), tipo: r.dados.tipo, ordem: doDia };
      t.aulas.push(alvo);
    } else {
      aula.data = r.dados.data;
      aula.tipo = r.dados.tipo;
      aula.conteudo = r.dados.conteudo.trim();
    }
    if (r.dados.categoria) { alvo.categoria = r.dados.categoria; alvo.categoriaFixa = true; }
    else { delete alvo.categoriaFixa; alvo.categoria = CC.categoriaPadrao(t, alvo.data); }
    salvar(); render();
  }

  /* ---------- tela: notas ---------- */

  /* ---------- provas detalhadas (questões e subitens) ---------- */

  const nb = x => (x == null ? '—' : CC.numBR(x, 2).replace(/,?0+$/, '').replace(/,$/, '') || '0');

  /** Planilha de correção de uma prova (notas por subitem, critério, justificativas): escolhe a avaliação e importa. */
  async function importarProvas(t, p, nomeArq) {
    const provas = p.provas;
    const blocos = provas.map((d, k) => {
      const nItens = d.questoes.reduce((s, q) => s + q.itens.length, 0);
      const max = d.questoes.reduce((s, q) => s + q.itens.reduce((x, it) => x + it.max, 0), 0);
      const achados = d.linhas.filter(l => CC.findAluno(t, { matricula: l.matricula, nome: l.nome, email: l.email }, false));
      const fora = d.linhas.filter(l => !achados.includes(l));
      const padrao = t.avaliacoes.find(v => CC.norm(v.nome) === CC.norm(d.nome));
      return `<fieldset class="grupo"><legend>${esc(d.nome || 'Prova ' + (k + 1))}</legend><div class="stack">
        <p class="small" style="margin:0">${d.questoes.length} questão(ões), ${nItens} subitem(ns), valor máximo ${nb(max)} ·
          ${achados.length} aluno(s) desta turma${fora.length ? `, <b>${fora.length} não encontrado(s)</b>` : ''}
          ${d.textos && d.textos.length ? ' · com justificativas' : ''}${d.questoes.some(q => q.regra || q.itens.some(it => it.regra || it.descricao)) ? ' · com critério' : ''}</p>
        ${fora.length ? `<details class="small muted"><summary>Não encontrados</summary>${fora.map(l => esc(l.nome || l.matricula)).join(', ')}</details>` : ''}
        <label class="field">Avaliação<select name="av_${k}">
          ${t.avaliacoes.map(v => `<option value="${v.id}" ${padrao === v ? 'selected' : ''}>${esc(v.nome)}${v.detalhe ? ' (já detalhada)' : ''}</option>`).join('')}
          <option value="nova" ${padrao ? '' : 'selected'}>Nova avaliação “${esc(d.nome || 'Prova')}”</option></select></label></div></fieldset>`;
    }).join('');
    const r = await dialogo(`<h2>Notas detalhadas da prova</h2>
      <p class="muted small">${esc(nomeArq)}: notas por questão e subitem${provas.some(d => d.textos && d.textos.length) ? ', critério e justificativas' : ''}. A nota da avaliação passa a ser a soma dos subitens.</p>
      ${blocos}
      <div class="checks"><label><input type="checkbox" name="substituir" checked> substituir o que já houver nessas avaliações (notas e detalhes)</label></div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Importar</button></div>`);
    if (r.acao !== 'ok') return;
    const msgs = [];
    provas.forEach((d, k) => {
      let v = t.avaliacoes.find(x => x.id === r.dados['av_' + k]);
      if (!v) {
        v = { id: CC.uid('v'), nome: d.nome || 'Prova', tipo: 'normal', data: '', peso: 1, max: 10 };
        t.avaliacoes.push(v);
      }
      if (r.dados.substituir) delete t.notas[v.id];
      const res = CC.aplicarProvaDetalhada(t, v, d, { substituir: !!r.dados.substituir });
      msgs.push(`${v.nome}: ${res.casados} aluno(s)` + (res.semAluno.length ? `, ${res.semAluno.length} não encontrado(s)` : '') +
        (res.divergentes.length ? `, ${res.divergentes.length} com soma diferente da nota da planilha` : ''));
      if (res.divergentes.length) console.warn('Somas diferentes', res.divergentes);
    });
    CC.sincronizarAvaliacoes(t);
    salvar(); go(`#/t/${t.id}/notas/${(t.avaliacoes.find(x => x.id === r.dados.av_0) || t.avaliacoes[t.avaliacoes.length - 1]).id}`);
    toast(msgs.join(' · '));
  }

  /** Questões e subitens da avaliação, em texto (cria ou altera o detalhamento). */
  async function editarEstrutura(t, av) {
    const det = av.detalhe;
    const r = await dialogo(`<h2>Questões de ${esc(av.nome)}</h2>
      <p class="muted small">Uma questão por linha: nome, dois-pontos e os subitens com o valor máximo, separados por ponto e vírgula.
      A nota da avaliação passa a ser a soma dos subitens.</p>
      <textarea name="estrutura" rows="8" style="font-family:monospace;font-size:14px" placeholder="Q1 — Fundamentos: 1a = 0,6; 1b = 0,5; 1c = 0,3; 1d = 0,6&#10;Q2 — Autômatos: 2a = 1; 2b = 1,1; 2c = 0,4&#10;Q3: 2,5">${esc(CC.estruturaParaTexto(det))}</textarea>
      <p class="small" id="soma-estr"></p>
      <div class="acoes">${det ? '<button class="btn danger" value="remover" formnovalidate>Tirar o detalhamento</button>' : ''}
      <button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`,
    form => {
      const ta = form.querySelector('[name=estrutura]'), out = form.querySelector('#soma-estr');
      const conta = () => {
        const e = CC.textoParaEstrutura(ta.value.replace(/^([^:=\n]+):\s*([\d.,]+)\s*$/gm, '$1: $1 = $2'), det);
        const soma = e.questoes.reduce((s, q) => s + q.itens.reduce((x, it) => x + it.max, 0), 0);
        out.textContent = `${e.questoes.length} questão(ões) · valor máximo ${nb(Math.round(soma * 100) / 100)}` + (e.erros.length ? ` · ${e.erros.length} linha(s) não entendida(s)` : '');
      };
      ta.addEventListener('input', conta); conta();
    });
    if (r.acao === 'remover') {
      if (await confirmar('Tirar o detalhamento', `As notas de ${esc(av.nome)} ficam como estão (a soma atual); as notas por subitem e as justificativas são apagadas.`, 'Tirar', true)) {
        delete av.detalhe; salvar(); render();
      }
      return;
    }
    if (r.acao !== 'ok') return;
    // "Q3: 2,5" (questão sem subitens) vira um subitem com o nome da questão.
    const e = CC.textoParaEstrutura(String(r.dados.estrutura).replace(/^([^:=\n]+):\s*([\d.,]+)\s*$/gm, '$1: $1 = $2'), det);
    if (!e.questoes.length) return toast('Nenhuma questão entendida.');
    if (e.erros.length && !await confirmar('Linhas não entendidas', e.erros.map(esc).join('<br>'), 'Salvar assim')) return;
    const ids = new Set(e.questoes.flatMap(q => q.itens.map(it => it.id)));
    if (det) Object.values(det.alunos).forEach(d => Object.keys(d.itens).forEach(id => { if (!ids.has(id)) delete d.itens[id]; }));
    av.detalhe = Object.assign(det || { alunos: {}, extras: [], textos: [] }, { questoes: e.questoes });
    CC.sincronizarNotasDetalhe(t, av);
    salvar(); render();
  }

  /** Critério de correção (descrição e regra de cada subitem). */
  function verCriterio(av) {
    const det = av.detalhe;
    dialogo(`<h2>Critério — ${esc(av.nome)}</h2>${det.criterioNota ? `<p class="muted small">${esc(det.criterioNota)}</p>` : ''}
      <div class="scroll">${det.questoes.map(q => `<h3 style="margin:12px 0 4px">${esc(q.nome)}${q.titulo ? ' — ' + esc(q.titulo) : ''} <span class="muted small">(${nb(CC.maxQuestao(q))})</span></h3>
        ${q.descricao || q.regra ? `<p class="small" style="margin:0 0 6px">${esc(q.descricao || '')}${q.regra ? `<br><span class="muted">${esc(q.regra)}</span>` : ''}</p>` : ''}
        <ul class="small" style="margin:0;padding-left:18px">${q.itens.map(it => `<li><b>${esc(it.nome)}</b> (${nb(it.max)})${it.descricao ? ' — ' + esc(it.descricao) : ''}${it.regra ? `<br><span class="muted">${esc(it.regra)}</span>` : ''}</li>`).join('')}</ul>`).join('')}</div>
      <div class="acoes"><button class="btn primary" value="">Fechar</button></div>`);
  }

  /** Notas de um aluno numa prova detalhada: subitens, situação, modelo, colunas extras e justificativas. */
  async function editarProvaAluno(t, av, a) {
    const det = av.detalhe;
    const d = det.alunos[a.id] || { situacao: 'Presente', modelo: '', itens: {}, extras: {}, textos: {} };
    const textos = det.textos && det.textos.length ? det.textos : det.questoes.map(q => q.nome).concat('Observações');
    const modelos = Array.from(new Set(Object.values(det.alunos).map(x => x.modelo).filter(Boolean))).sort();
    const r = await dialogo(`<h2>${esc(nomeCurto(a.nome))} — ${esc(av.nome)}</h2><div class="stack">
      <div class="row nowrap"><label class="field grow">Situação<select name="situacao"><option ${d.situacao !== 'Ausente' ? 'selected' : ''}>Presente</option><option ${d.situacao === 'Ausente' ? 'selected' : ''}>Ausente</option></select></label>
      <label class="field grow">Modelo<input type="text" name="modelo" list="modelos-prova" value="${esc(d.modelo || '')}"></label></div>
      <datalist id="modelos-prova">${modelos.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
      ${det.questoes.map(q => `<fieldset class="grupo"><legend>${esc(q.nome)}${q.titulo ? ' — ' + esc(q.titulo) : ''} <span class="muted small" data-totq="${esc(q.nome)}"></span></legend>
        <div class="row">${q.itens.map(it => `<label class="field" style="width:5.5em">${esc(it.nome)} <span class="muted small">/ ${nb(it.max)}</span>
          <input type="text" inputmode="decimal" name="it_${it.id}" data-max="${it.max}" value="${typeof d.itens[it.id] === 'number' ? String(d.itens[it.id]).replace('.', ',') : ''}"></label>`).join('')}</div>
        ${textos.includes(q.nome) ? `<textarea name="tx_${esc(q.nome)}" rows="2" placeholder="Justificativa">${esc((d.textos || {})[q.nome] || '')}</textarea>` : ''}</fieldset>`).join('')}
      ${(det.extras || []).map(e => `<label class="field">${esc(e)}<input type="text" name="ex_${esc(e)}" value="${esc((d.extras || {})[e] || '')}"></label>`).join('')}
      ${textos.filter(k => !det.questoes.some(q => q.nome === k)).map(k => `<label class="field">${esc(k)}<textarea name="tx_${esc(k)}" rows="2">${esc((d.textos || {})[k] || '')}</textarea></label>`).join('')}
      <p class="small"><b id="tot-prova"></b></p></div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`,
    form => {
      const conta = () => {
        let tot = 0, algum = false;
        det.questoes.forEach(q => {
          let tq = 0, aq = false;
          q.itens.forEach(it => { const x = parseFloat(String(form.querySelector(`[name="it_${it.id}"]`).value).replace(',', '.')); if (!isNaN(x)) { tq += x; aq = true; } });
          const el = form.querySelector(`[data-totq="${CSS.escape(q.nome)}"]`);
          if (el) el.textContent = aq ? `${nb(Math.round(tq * 100) / 100)} / ${nb(CC.maxQuestao(q))}` : '';
          tot += tq; algum = algum || aq;
        });
        const aus = form.querySelector('[name=situacao]').value === 'Ausente';
        form.querySelector('#tot-prova').textContent = aus ? 'Ausente: sem nota' : algum ? `Nota: ${nb(Math.round(tot * 100) / 100)} de ${nb(CC.maxDetalhe(det))}` : '';
      };
      form.addEventListener('input', conta); form.addEventListener('change', conta); conta();
    });
    if (r.acao !== 'ok') return;
    const nd = { situacao: r.dados.situacao === 'Ausente' ? 'Ausente' : 'Presente', modelo: String(r.dados.modelo || '').trim(), itens: {}, extras: {}, textos: {} };
    let erro = '';
    CC.itensDe(det).forEach(it => {
      const s = String(r.dados['it_' + it.id] || '').trim().replace(',', '.');
      if (!s) return;
      const x = parseFloat(s);
      if (isNaN(x) || x < 0 || x > it.max + 1e-9) erro = `${it.q.nome} ${it.nome}: nota de 0 a ${nb(it.max)}`;
      else nd.itens[it.id] = x;
    });
    if (erro) return toast(erro);
    (det.extras || []).forEach(e => { const v = String(r.dados['ex_' + e] || '').trim(); if (v) nd.extras[e] = v; });
    textos.forEach(k => { const v = String(r.dados['tx_' + k] || '').trim(); if (v) nd.textos[k] = v; });
    det.alunos[a.id] = nd;
    CC.sincronizarNotasDetalhe(t, av);
    salvar(); render();
  }

  /** Tela da avaliação detalhada: resumo por questão e alunos com o total de cada questão. */
  function htmlProvaDetalhada(t, av) {
    const det = av.detalhe, est = CC.estatisticasProva(t, av);
    const pct = (m, x) => (m != null && x ? Math.round(m / x * 100) + '%' : '—');
    let h = `<div class="card"><div class="row"><div class="grow"><b>${det.questoes.length} questão(ões)</b> · máx. ${nb(est.max)}
        <div class="muted small">${est.presentes} com nota · ${est.ausentes} ausente(s)${est.geral ? ` · média ${nb(est.geral.media)} (${nb(est.geral.menor)} a ${nb(est.geral.maior)})` : ''}</div></div>
        <button class="btn small" id="criterio">Critério</button><button class="btn small" id="estrutura">Questões</button></div>
      <div class="tabela-wrap"><table class="small"><thead><tr><th>Questão</th><th class="num">Máx.</th><th class="num">Média</th><th class="num">%</th><th class="num">Zeros</th></tr></thead><tbody>
      ${est.questoes.map(x => `<tr><td>${esc(x.q.nome)}${x.q.titulo ? ' <span class="muted">' + esc(x.q.titulo) + '</span>' : ''}</td><td class="num">${nb(x.max)}</td><td class="num">${nb(x.media)}</td><td class="num">${pct(x.media, x.max)}</td><td class="num">${x.zeros == null ? '—' : x.zeros}</td></tr>`).join('')}
      </tbody></table></div>
      ${est.modelos.length > 1 ? `<p class="muted small" style="margin:6px 0 0">Por modelo: ${est.modelos.map(m => `${esc(m.modelo)} ${nb(m.media)} (${m.n})`).join(' · ')}</p>` : ''}</div>
      <div class="tabela-wrap"><table><thead><tr><th>Aluno</th>${det.questoes.map(q => `<th class="num">${esc(q.nome)}</th>`).join('')}<th class="num">${esc(av.nome)}</th></tr></thead><tbody>`;
    h += CC.alunosOrdenados(t, false).map(a => {
      const d = det.alunos[a.id];
      const aus = d && d.situacao === 'Ausente';
      const tot = CC.totalAluno(det, a.id);
      return `<tr data-prova="${a.id}" style="cursor:pointer"><td class="nome-cel">${esc(nomeCurto(a.nome))}${d && d.modelo ? ` <span class="muted small">${esc(d.modelo)}</span>` : ''}${d && (d.extras || {}).Alertas ? ' <span class="tag VS">!</span>' : ''}</td>
        ${aus ? `<td colspan="${det.questoes.length + 1}" class="muted small">ausente</td>` : det.questoes.map(q => `<td class="num">${nb(CC.totalQuestao(det, a.id, q))}</td>`).join('') + `<td class="num"><b>${nb(tot)}</b></td>`}</tr>`;
    }).join('') + '</tbody></table></div>';
    return h;
  }

  function telaNotas(t, avId) {
    const avs = t.avaliacoes;
    let listaNotas = null;
    const vs = CC.avaliacaoTipo(t, 'VS'), vr = CC.avaliacaoTipo(t, 'VR');
    let h = `<div class="card"><div class="row"><div class="grow"><b>Avaliações</b>
      <div class="muted small">Média = soma(peso × nota ÷ máx. × 10) ÷ soma dos pesos${vr ? ' · VR substitui a prova perdida' : ''}${vs ? ` · média entre ${CC.numBR(t.config.mediaVS)} e ${CC.numBR(t.config.mediaMin)} faz VS` : ''}</div></div>
      <button class="btn small" id="plano">Plano de avaliação</button></div>`;
    if (avs.length) {
      h += `<div class="checks" style="margin-top:10px">` + avs.map(v => {
        const normal = !v.tipo || v.tipo === 'normal';
        const det = [v.data ? CC.fmtDate(v.data).slice(0, 5) : '', normal ? '×' + CC.numBR(v.peso, v.peso % 1 ? 1 : 0) : ''].filter(Boolean).join(' · ');
        return `<a class="btn small ${v.id === avId ? 'primary' : ''}" href="#/t/${t.id}/notas/${v.id}">${esc(v.nome)}${det ? ` <span class="small" style="opacity:.7">${det}</span>` : ''}</a>`;
      }).join('') + '</div>';
    }
    h += '</div>';
    const av = avs.find(v => v.id === avId);
    if (av) {
      const notas = t.notas[av.id] || {};
      h += `<div class="card"><div class="row"><div class="grow"><h3>${esc(av.nome)}</h3>
        <div class="muted small">nota de 0 a ${av.max}${av.data ? ' · ' + CC.fmtDate(av.data, true) : ''} · ${av.tipo === 'VR' ? 'substitui a prova perdida' : av.tipo === 'VS' ? 'suplementar' : 'peso ' + CC.numBR(av.peso, av.peso % 1 ? 1 : 0)}</div></div>
        ${av.detalhe ? '' : '<button class="btn small" id="detalhar">Detalhar por questões</button>'}<button class="btn small" id="edit-av">Editar</button></div></div>` +
        (av.detalhe ? htmlProvaDetalhada(t, av) : `<div class="lista-chamada">` + CC.alunosOrdenados(t, false).map(a => {
        const n = notas[a.id];
        return `<div class="aluno-row"><div class="nome">${esc(nomeCurto(a.nome))}<div class="det">${esc(a.matricula)}</div></div>
          <input type="text" inputmode="decimal" class="nota-input" data-aluno="${a.id}" value="${typeof n === 'number' ? String(n).replace('.', ',') : ''}" enterkeyhint="next"></div>`;
      }).join('') + '</div>');
    } else if (avs.length) {
      const lista = CC.alunosVisao(t, visaoDe(t), a => cursoDe(t, a));
      h += cartaoEstatisticas(t) + barraVisao(t, CC.alunosOrdenados(t, false).length, lista) + tabelaNotas(t, lista);
      listaNotas = lista;
    } else {
      h += `<div class="card empty">Defina o plano de avaliação (quantas provas, datas e pesos) para lançar as notas.</div>`;
    }
    app.innerHTML = h;
    $('#plano').onclick = () => editarPlano(t);
    if (listaNotas) {
      ligarBarraVisao(t, listaNotas);
      app.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => go(`#/t/${t.id}/aluno/${tr.dataset.id}`));
    }
    if (av) {
      $('#edit-av').onclick = () => editarAvaliacao(t, av);
      const dt = $('#detalhar'); if (dt) dt.onclick = () => editarEstrutura(t, av);
      if (av.detalhe) {
        $('#criterio').onclick = () => verCriterio(av);
        $('#estrutura').onclick = () => editarEstrutura(t, av);
        app.querySelectorAll('tr[data-prova]').forEach(tr => tr.onclick = () => editarProvaAluno(t, av, t.alunos.find(a => a.id === tr.dataset.prova)));
      }
      const inputs = Array.from(app.querySelectorAll('.nota-input'));
      inputs.forEach((inp, k) => {
        inp.addEventListener('change', () => {
          const m = t.notas[av.id] || (t.notas[av.id] = {});
          const txt = inp.value.trim().replace(',', '.');
          if (!txt) { delete m[inp.dataset.aluno]; salvar(); return; }
          const v = parseFloat(txt);
          if (isNaN(v) || v < 0 || v > av.max) { toast(`Nota inválida (0 a ${av.max})`); inp.value = ''; delete m[inp.dataset.aluno]; }
          else m[inp.dataset.aluno] = v;
          salvar();
        });
        inp.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') { ev.preventDefault(); (inputs[k + 1] || inp).focus(); if (!inputs[k + 1]) inp.blur(); }
        });
      });
    }
  }

  function tabelaNotas(t, lista) {
    const avs = t.avaliacoes;
    const vs = CC.avaliacaoTipo(t, 'VS');
    return `<div class="tabela-wrap"><table><thead><tr><th>Aluno</th>${avs.map(v => `<th class="num">${esc(v.nome)}</th>`).join('')}<th class="num">${vs ? 'MP' : 'Média'}</th>${vs ? '<th class="num">MF</th>' : ''}<th>Situação</th></tr></thead><tbody>` +
      lista.map(({ a, st }) => {
        return `<tr data-id="${a.id}" style="cursor:pointer"><td class="nome-cel">${esc(nomeCurto(a.nome))}</td>${avs.map(v => {
          const n = (t.notas[v.id] || {})[a.id];
          return `<td class="num">${typeof n === 'number' ? CC.numBR(n, n % 1 ? 1 : 0) : ''}</td>`;
        }).join('')}<td class="num"><b>${st.media != null ? CC.numBR(st.media) : ''}</b></td>
        ${vs ? `<td class="num"><b>${st.mf != null ? CC.numBR(st.mf) : ''}</b></td>` : ''}
        <td>${st.situacao.texto ? `<span class="tag ${st.situacao.cod}">${st.situacao.texto}</span>` : ''}</td></tr>`;
      }).join('') + '</tbody></table></div>';
  }

  async function editarAvaliacao(t, av) {
    const nova = !av;
    const v = av || { nome: '', tipo: 'normal', data: '', peso: 1, max: 10 };
    const r = await dialogo(`<h2>${nova ? 'Nova avaliação' : 'Avaliação'}</h2><div class="stack">
      <label class="field">Nome<input type="text" name="nome" value="${esc(v.nome)}" required autofocus placeholder="ex.: P1"></label>
      <div class="row nowrap"><label class="field grow">Tipo<select name="tipo">${Object.keys(CC.TIPOS_AVALIACAO).map(k => `<option value="${k}" ${(v.tipo || 'normal') === k ? 'selected' : ''}>${CC.TIPOS_AVALIACAO[k]}</option>`).join('')}</select></label>
      <label class="field grow">Data<input type="date" name="data" value="${esc(v.data || '')}"></label></div>
      <div class="row nowrap"><label class="field grow">Peso (só para "entra na média")<input type="text" inputmode="decimal" name="peso" value="${String(v.peso).replace('.', ',')}"></label>
      <label class="field grow">Nota máxima<input type="text" inputmode="decimal" name="max" value="${String(v.max).replace('.', ',')}"></label></div></div>
      <div class="acoes">${nova ? '' : '<button class="btn danger" value="remover" formnovalidate>Excluir</button>'}
      <button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao === 'remover') {
      const ok = await confirmar('Excluir avaliação', `Excluir <b>${esc(av.nome)}</b> e todas as notas lançadas nela?`, 'Excluir', true);
      if (ok) {
        t.avaliacoes = t.avaliacoes.filter(x => x.id !== av.id);
        delete t.notas[av.id];
        salvar(); go(`#/t/${t.id}/notas`);
      }
      return;
    }
    if (r.acao !== 'ok') return;
    const num = s => parseFloat(String(s).replace(',', '.'));
    const tipo = r.dados.tipo || 'normal';
    const dados = { nome: r.dados.nome.trim(), tipo, data: r.dados.data || '', peso: tipo === 'normal' ? num(r.dados.peso) : 0, max: num(r.dados.max) };
    if (!dados.nome || isNaN(dados.peso) || !(dados.max > 0)) return toast('Preencha nome, peso e nota máxima');
    if (tipo !== 'normal' && t.avaliacoes.some(x => x !== av && x.tipo === tipo)) return toast('Já existe uma ' + tipo + ' no plano');
    if (nova) {
      const nv = Object.assign({ id: CC.uid('v') }, dados);
      t.avaliacoes.push(nv);
      CC.sincronizarAvaliacoes(t);
      salvar(); go(`#/t/${t.id}/notas/${nv.id}`);
    } else {
      Object.assign(av, dados);
      CC.sincronizarAvaliacoes(t);
      salvar(); render();
    }
  }

  /* ---------- tela: resumo ---------- */

  function telaResumo(t) {
    const todos = CC.alunosOrdenados(t, false);
    const temNotas = t.avaliacoes.length > 0;
    const temVS = !!CC.avaliacaoTipo(t, 'VS');
    const stats = CC.alunosVisao(t, visaoDe(t), a => cursoDe(t, a));
    const todosStats = todos.map(a => CC.statsAluno(t, a));
    const rf = todosStats.filter(s => s.situacao.cod === 'RF').length;
    const lim = todosStats.filter(s => s.situacao.cod === 'LIM').length;
    const dadas = t.aulas.filter(a => CC.aulaRealizada(t, a)).length;
    let h = `<div class="card"><div class="row"><div class="grow">
      <b>${dadas}</b> de ${CC.aulasPrevistas(t)} aulas com chamada · máximo de <b>${limTxt(t)}</b> faltas
      <div class="muted small">${rf} reprovado(s) por falta · ${lim} perto do limite · atraso vale ${CC.numBR(t.config.pesoAtraso, 2)} falta</div>
      ${!(t.config.cargaHoraria > 0) ? `<div class="small" style="color:var(--A);margin-top:6px">Sem carga horária: o limite usa só as aulas do cronograma. Informe a carga nas configurações da turma.</div>` : ''}</div>
      <button class="btn small primary" id="exportar">Exportar .xlsx</button></div></div>`;
    h += barraVisao(t, todos.length, stats);
    h += `<div class="tabela-wrap"><table><thead><tr><th>Aluno</th><th class="num">P</th><th class="num">A</th><th class="num">J</th><th class="num">F</th><th class="num">Faltas</th><th class="num">Freq.</th>${temNotas ? `<th class="num">${temVS ? 'MP' : 'Média'}</th>` : ''}${temVS ? '<th class="num">MF</th>' : ''}<th>Situação</th></tr></thead><tbody>` +
      (stats.length ? stats.map(({ a, st }) => `<tr data-id="${a.id}" style="cursor:pointer"><td class="nome-cel">${esc(nomeCurto(a.nome))}</td>
        <td class="num">${st.P}</td><td class="num">${st.A}</td><td class="num">${st.J}</td><td class="num">${st.F}</td>
        <td class="num"><b>${CC.numBR(st.faltas)}</b></td><td class="num">${st.freq != null ? Math.round(st.freq * 100) + '%' : ''}</td>
        ${temNotas ? `<td class="num">${st.media != null ? CC.numBR(st.media) : ''}</td>` : ''}${temVS ? `<td class="num">${st.mf != null ? CC.numBR(st.mf) : ''}</td>` : ''}
        <td>${st.situacao.texto ? `<span class="tag ${st.situacao.cod}">${st.situacao.texto}</span>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="10" class="empty">Nenhum aluno neste filtro.</td></tr>`) +
      '</tbody></table></div>';
    app.innerHTML = h;
    $('#exportar').onclick = () => exportar(t);
    ligarBarraVisao(t, stats);
    app.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => go(`#/t/${t.id}/aluno/${tr.dataset.id}`));
  }

  /* ---------- início ---------- */

  /* Atualização: procura versão nova ao abrir e ao voltar para o app; quando o service worker
   * novo assume, recarrega (esperando fechar um diálogo aberto) e avisa a versão. */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const jaControlada = !!navigator.serviceWorker.controller;
    let recarregando = false;
    const recarregar = () => {
      if (recarregando) return;
      recarregando = true;
      try { sessionStorage.setItem('cc-atualizado', '1'); } catch (e) { /* sem sessionStorage */ }
      clearTimeout(salvarTimer); gravarAgora();
      location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!jaControlada) return;               // primeira instalação: nada a recarregar
      const dlg = $('#dlg');
      if (dlg.open) dlg.addEventListener('close', recarregar, { once: true });
      else recarregar();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(e => console.warn('SW', e));
  }
  try {
    if (sessionStorage.getItem('cc-atualizado')) {
      sessionStorage.removeItem('cc-atualizado');
      setTimeout(() => toast('App atualizado para a versão ' + VERSAO), 300);
    }
  } catch (e) { /* sem sessionStorage */ }
  // Ganchos para depuração no console.
  window.__cc = { get db() { return db; }, salvar, render, cursos, importarVarias, atualizarVariasListas, escolherColunas, importarNaTurma, importarProvas, importarNovaTurma, importarPasta, entradasDoZip, linhasDoPDF, lerCalendarioPDF };
  // O IndexedDB pode ter dados mais novos (ou os únicos, quando não couberam no localStorage).
  if (window.indexedDB) {
    idbLer().then(json => {
      const estava = aguardandoIDB;
      aguardandoIDB = false;
      if (!json) { if (db.turmas.length) gravarAgora(); return; }
      const d = JSON.parse(json);
      if (estava || (d.salvoEm || 0) > (db.salvoEm || 0)) { db = normalizarDb(d); render(); }
    }).catch(() => { aguardandoIDB = false; });
  }
  render();
})();
