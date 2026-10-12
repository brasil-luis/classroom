/* ClassroomControl — lista de presença em PDF (A4 em pé), com jsPDF carregado sob demanda.
 * Recebe os dados de CC.dadosListaPresenca: nome riscado = passou do limite de faltas. */
(function (g) {
  'use strict';
  const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  function carregar() {
    if (g.jspdf) return Promise.resolve();
    return new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = JSPDF; s.crossOrigin = 'anonymous';
      s.onload = ok;
      s.onerror = () => { s.remove(); erro(new Error('não consegui baixar o gerador de PDF (é preciso internet na primeira vez)')); };
      document.head.appendChild(s);
    });
  }

  // Medidas em mm. Colunas: Nº, Matrícula, Nome, Curso, Assinatura (somam a largura útil).
  const PAG_A = 297, MARG = 12, LARG = 186;
  const COLS = [9, 22, 72, 27, 56];
  const CAB = ['Nº', 'Matrícula', 'Nome', 'Curso', 'Assinatura'];
  const ALT_CAB = 7, ALT_LINHA = 8.8, RODAPE = 10;
  const AZUL = [31, 78, 121], TEXTO = [33, 37, 41], CINZA = [120, 120, 120], RISCADO = [150, 150, 150];
  const PT = 0.3528; // mm por ponto

  /** Escreve linhas centradas na vertical da célula; riscadas se pedido. */
  function texto(doc, linhas, x, topo, alt, tam, opc) {
    opc = opc || {};
    doc.setFontSize(tam);
    const lh = tam * PT * 1.18;
    let y = topo + (alt - lh * linhas.length) / 2 + lh * 0.78;
    linhas.forEach(l => {
      const w = doc.getTextWidth(l);
      const xi = opc.centro ? x - w / 2 : x;
      doc.text(l, xi, y);
      if (opc.risca) {
        const ym = y - tam * PT * 0.3;
        doc.setLineWidth(0.25);
        doc.line(xi - 0.3, ym, xi + w + 0.3, ym);
      }
      y += lh;
    });
  }

  /** Quebra em no máximo `max` linhas, diminuindo a fonte se preciso. */
  function caber(doc, s, larg, tam, min, max) {
    for (let t = tam; t >= min; t -= 0.5) {
      doc.setFontSize(t);
      const l = doc.splitTextToSize(s, larg);
      if (l.length <= max) return { linhas: l, tam: t };
    }
    doc.setFontSize(min);
    return { linhas: doc.splitTextToSize(s, larg).slice(0, max), tam: min };
  }

  async function gerar(dl) {
    await carregar();
    const doc = new g.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    doc.setProperties({ title: dl.titulo + ' — ' + dl.disciplina });
    // Sem curso (instituição fora da regra da UFF): a coluna some e o nome ganha o espaço.
    const cols = dl.linhas.some(l => l.curso) ? COLS : [COLS[0], COLS[1], COLS[2] + COLS[3], 0, COLS[4]];
    const xs = cols.reduce((acc, w) => acc.concat(acc[acc.length - 1] + w), [MARG]);

    function cabecalhoTabela(y) {
      doc.setFillColor(...AZUL);
      doc.rect(MARG, y, LARG, ALT_CAB, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
      CAB.forEach((h, c) => {
        if (!cols[c]) return;
        if (c === 2) texto(doc, [h], xs[c] + 1.5, y, ALT_CAB, 9);
        else texto(doc, [h], xs[c] + cols[c] / 2, y, ALT_CAB, 9, { centro: true });
      });
      return y + ALT_CAB;
    }

    // Cabeçalho da 1ª página
    let y = MARG;
    doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold');
    texto(doc, [dl.titulo], MARG, y, 8, 15); y += 9;
    doc.setTextColor(...TEXTO);
    texto(doc, [dl.disciplina], MARG, y, 6, 11); y += 6;
    doc.setFont('helvetica', 'normal');
    if (dl.info) { texto(doc, [dl.info.replace(/\s{2,}/g, ' ')], MARG, y, 5, 9); y += 5.5; }
    doc.setFont('helvetica', 'bold');
    texto(doc, ['Data: ' + (dl.data || '____/____/________')], MARG, y + 1, 7, 10);
    doc.setFont('helvetica', 'normal');
    texto(doc, ['Professor(a): ________________________________'], MARG + 80, y + 1, 7, 10);
    y += 11;
    y = cabecalhoTabela(y);

    dl.linhas.forEach((l, i) => {
      if (y + ALT_LINHA > PAG_A - MARG - RODAPE) {
        doc.addPage();
        doc.setTextColor(...CINZA); doc.setFont('helvetica', 'normal');
        texto(doc, [dl.titulo + ' — ' + dl.disciplina + (dl.data ? ' — ' + dl.data : '')], MARG, MARG - 2, 6, 8);
        y = cabecalhoTabela(MARG + 5);
      }
      if (i % 2) { doc.setFillColor(244, 246, 248); doc.rect(MARG, y, LARG, ALT_LINHA, 'F'); }
      doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.2);
      cols.forEach((w, c) => { if (w) doc.rect(xs[c], y, w, ALT_LINHA); });
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...CINZA);
      texto(doc, [String(i + 1)], xs[0] + cols[0] / 2, y, ALT_LINHA, 8, { centro: true });
      const cor = l.risca ? RISCADO : TEXTO;
      doc.setTextColor(...cor); doc.setDrawColor(...cor);
      if (l.matricula) texto(doc, [l.matricula], xs[1] + cols[1] / 2, y, ALT_LINHA, 9.5, { centro: true, risca: l.risca });
      if (l.nome) {
        const n = caber(doc, l.nome, cols[2] - 3, 9.5, 7.5, 2);
        texto(doc, n.linhas, xs[2] + 1.5, y, ALT_LINHA, n.tam, { risca: l.risca });
      }
      if (l.curso) {
        doc.setTextColor(...(l.risca ? RISCADO : CINZA));
        const c = caber(doc, l.curso, cols[3] - 2, 6.5, 5.5, 2);
        texto(doc, c.linhas, xs[3] + 1, y, ALT_LINHA, c.tam, { risca: l.risca });
      }
      y += ALT_LINHA;
    });

    doc.setTextColor(...CINZA); doc.setFont('helvetica', 'italic');
    if (y + 7 > PAG_A - MARG - RODAPE) { doc.addPage(); y = MARG; }
    texto(doc, [dl.nota], MARG, y + 1.5, 6, 8.5);

    // Rodapé: página x de y
    const total = doc.getNumberOfPages();
    doc.setFont('helvetica', 'normal');
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setTextColor(...CINZA);
      texto(doc, [`página ${p} de ${total}`], MARG + LARG / 2, PAG_A - MARG - 4, 5, 8, { centro: true });
    }
    return doc.output('blob');
  }

  g.ListaPDF = { gerar, carregar, URL: JSPDF };
})(window);
