/* ClassroomControl — pasta de trabalho (File System Access API).
 * Guarda a pasta escolhida (geral, uma por projeto e, se quiser, uma por turma) no IndexedDB do navegador,
 * para exportar e importar direto nela. Onde a API não existe (parte dos navegadores do
 * Android), o app continua usando baixar/compartilhar. */
(function (g) {
  'use strict';
  const FALHOU = 'cc-seletor-falhou';

  /** Navegadores que rodam sobre o WebView do Android (DuckDuckGo e outros apps): a função
   *  existe, mas o app hospedeiro não mostra o seletor e cancela na hora. */
  function navegadorSemSeletor(ua) {
    return /DuckDuckGo/i.test(ua) || /; wv\)/.test(ua);
  }

  let falhouAntes = false;
  try { falhouAntes = localStorage.getItem(FALHOU) === '1'; } catch (e) { /* sem localStorage */ }
  const bloqueado = navegadorSemSeletor(navigator.userAgent) || falhouAntes;
  const suportada = !bloqueado && typeof g.showDirectoryPicker === 'function';
  const suportaSalvarComo = !bloqueado && typeof g.showSaveFilePicker === 'function';

  /** O seletor cancelou sozinho: não oferecer mais pasta nem "salvar como" neste navegador. */
  function marcarSemSeletor() {
    try { localStorage.setItem(FALHOU, '1'); } catch (e) { /* sem localStorage */ }
    g.Pasta.suportada = false;
    g.Pasta.suportaSalvarComo = false;
  }

  let banco = null;
  function idb() {
    if (!banco) {
      banco = new Promise((ok, erro) => {
        const req = indexedDB.open('classroomcontrol-pastas', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('h');
        req.onsuccess = () => ok(req.result);
        req.onerror = () => erro(req.error);
      });
    }
    return banco;
  }

  async function operar(modo, fn) {
    const db = await idb();
    return new Promise((ok, erro) => {
      const tx = db.transaction('h', modo);
      const req = fn(tx.objectStore('h'));
      tx.oncomplete = () => ok(req ? req.result : undefined);
      tx.onerror = () => erro(tx.error);
    });
  }

  const chave = t => t ? 't:' + t.id : 'global';
  const obter = k => operar('readonly', s => s.get(k)).catch(() => null);
  const guardar = (k, h) => operar('readwrite', s => s.put(h, k));
  const esquecer = k => operar('readwrite', s => s.delete(k));

  /** Pede (se preciso) permissão de leitura e escrita; precisa de um toque recente do usuário. */
  async function permitir(h) {
    const o = { mode: 'readwrite' };
    if (await h.queryPermission(o) === 'granted') return true;
    return (await h.requestPermission(o)) === 'granted';
  }

  async function escolher(k) {
    const id = k === 'global' ? 'chamada-geral' : k.startsWith('p:') ? 'chamada-projeto' : 'chamada-turma';
    const h = await g.showDirectoryPicker({ id, mode: 'readwrite', startIn: 'documents' });
    await guardar(k, h);
    return h;
  }

  /** Pasta a usar para a turma (a dela, a do projeto ou a geral), já com permissão; ou null. */
  async function da(t) {
    if (!suportada) return null;
    for (const k of [t ? chave(t) : null, t && t.projetoId ? 'p:' + t.projetoId : null, 'global'].filter(Boolean)) {
      const h = await obter(k);
      if (!h) continue;
      try { if (await permitir(h)) return { handle: h, chave: k }; } catch (e) { /* sem permissão */ }
    }
    return null;
  }

  async function existe(h, nome) {
    try { await h.getFileHandle(nome); return true; } catch (e) { return false; }
  }

  async function gravar(h, nome, blob) {
    const fh = await h.getFileHandle(nome, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  /** Arquivos da pasta com as extensões dadas, do mais recente ao mais antigo. */
  async function listar(h, exts) {
    const out = [];
    for await (const e of h.values()) {
      if (e.kind !== 'file' || !exts.some(x => e.name.toLowerCase().endsWith(x))) continue;
      const f = await e.getFile();
      out.push({ nome: e.name, data: f.lastModified, tamanho: f.size, handle: e });
    }
    return out.sort((a, b) => b.data - a.data);
  }

  /** Planilhas da pasta e das subpastas (até `prof` níveis): [{ file, caminho: ['UFF-TCC00305-LFTC', 'x.xlsx'] }]. */
  async function arquivos(h, exts, prof, caminho) {
    caminho = caminho || [];
    let out = [];
    for await (const e of h.values()) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      if (e.kind === 'directory') {
        if (prof > 0) out = out.concat(await arquivos(e, exts, prof - 1, caminho.concat(e.name)));
      } else if (exts.some(x => e.name.toLowerCase().endsWith(x))) {
        out.push({ file: await e.getFile(), caminho: caminho.concat(e.name) });
      }
    }
    return out.sort((a, b) => a.caminho.join('/').localeCompare(b.caminho.join('/')));
  }

  async function salvarComo(nome, blob, inicio) {
    const h = await g.showSaveFilePicker({ suggestedName: nome, startIn: inicio || 'documents' });
    const w = await h.createWritable();
    await w.write(blob);
    await w.close();
    return h.name;
  }

  g.Pasta = { suportada, suportaSalvarComo, navegadorSemSeletor, marcarSemSeletor, chave, obter, guardar, escolher, esquecer, permitir, da, existe, gravar, listar, arquivos, salvarComo };
})(window);
