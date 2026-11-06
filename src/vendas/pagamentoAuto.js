const { normalizarTelefone } = require('./assinaturaOficial')

const STATUS = Object.freeze({
    PROCESSANDO: 'PROCESSANDO',
    AGUARDANDO_ENTREGA: 'AGUARDANDO_ENTREGA',
    CONCLUIDO: 'CONCLUIDO',
    AGUARDANDO_ADMIN: 'AGUARDANDO_ADMIN',
    AGUARDANDO_APP: 'AGUARDANDO_APP',
    ERRO: 'ERRO'
})

const STATUS_FINAIS = new Set([
    STATUS.AGUARDANDO_ENTREGA,
    STATUS.CONCLUIDO,
    STATUS.AGUARDANDO_ADMIN,
    STATUS.ERRO
])

const LABEL_CONTEUDO = /\bconte[uú]do\b\s*[:=\-]?\s*([^\n\r]{0,120})/gi
const NUMERO_VODACOM = /(?:\+?258[\s.-]?)?(8[45](?:[\s.-]?\d){7})(?!\d)/g
const TELEFONE_PAGADOR = /(?:recebeu|recebido|creditado|transferiu)[^]*?\bde\s+(?:\+?258)?(8[2-7]\d{7})/i
const NOME_PAGADOR = /(?:de|do)\s+(?:\+?258)?[\d\s.-]{9,16}\s*[-–,]\s*([^\n\r,]+?)\s+(?:as|às|em|no|com)\b/i

function normalizarCodigo(valor) {
    return String(valor || '').trim().toUpperCase()
}

function extrairNumerosVodacom(segmento) {
    const encontrados = []
    const texto = String(segmento || '')
    NUMERO_VODACOM.lastIndex = 0
    let match
    while ((match = NUMERO_VODACOM.exec(texto)) !== null) {
        const numero = normalizarTelefone(match[1])
        if (/^8[45]\d{7}$/.test(numero)) encontrados.push(numero)
    }
    return encontrados
}

function extrairNumeroConteudo(rawText) {
    const texto = String(rawText || '')
    if (!texto.trim()) return { ok: false, motivo: 'sem_conteudo', numeros: [] }

    const numeros = []
    let temLabel = false
    LABEL_CONTEUDO.lastIndex = 0
    let label
    while ((label = LABEL_CONTEUDO.exec(texto)) !== null) {
        temLabel = true
        for (const numero of extrairNumerosVodacom(label[1])) {
            if (!numeros.includes(numero)) numeros.push(numero)
        }
    }

    if (!temLabel) {
        return { ok: false, motivo: 'sem_conteudo', numeros }
    }
    if (numeros.length === 0) {
        return { ok: false, motivo: 'conteudo_invalido', numeros }
    }
    if (numeros.length > 1) {
        return { ok: false, motivo: 'conteudo_multiplo', numeros }
    }
    return { ok: true, numero: numeros[0], numeros }
}

function extrairPagador(rawText, registro = {}) {
    const texto = String(rawText || '')
    let telefone = normalizarTelefone(registro.phone)
    if (!telefone) {
        const matchTelefone = texto.match(TELEFONE_PAGADOR)
        if (matchTelefone) telefone = normalizarTelefone(matchTelefone[1])
    }

    let nome = ''
    const matchNome = texto.match(NOME_PAGADOR)
    if (matchNome) nome = String(matchNome[1] || '').trim().replace(/\s+/g, ' ')

    if (!nome) {
        const nomeRegistro = String(registro.name || '').trim()
        if (nomeRegistro && !/^desconhecido$/i.test(nomeRegistro)) nome = nomeRegistro
    }

    return { telefone, nome }
}

function classificarPacotes(pacotes) {
    const lista = Array.isArray(pacotes) ? pacotes : []
    const saldos = lista.filter(p => /saldo/i.test(String(p?.tipo || '')) || /saldo/i.test(String(p?.gb || '')))
    const dados = lista.filter(p => !saldos.includes(p) && Number(p?.mb || 0) > 0)
    return { saldos, dados }
}

function selecionarPacote(pacotes) {
    const { saldos, dados } = classificarPacotes(pacotes)
    if (saldos.length > 0) return { ok: false, motivo: 'saldo', pacotes: dados, saldos }
    if (dados.length === 0) return { ok: false, motivo: 'sem_pacote', pacotes: [] }
    if (dados.length > 1) return { ok: false, motivo: 'ambiguo', pacotes: dados }
    return { ok: true, pacote: dados[0] }
}

function resolverPacote(valor, grupoId) {
    const valorNumerico = Number(valor)
    if (!(valorNumerico > 0)) return { ok: false, motivo: 'valor_invalido', pacotes: [] }
    const { obterTodosPacotesPorValor } = require('./tabela')
    const pacotes = obterTodosPacotesPorValor(valorNumerico, grupoId)
    return selecionarPacote(pacotes)
}

function chavePagamento(centralCode, txId) {
    const central = normalizarCodigo(centralCode) || 'SEM_CENTRAL'
    const tx = normalizarCodigo(txId).replace(/[^A-Z0-9_-]/g, '_')
    return `${central}__${tx}`
}

function getStore() {
    return require('../utils/firebaseDataLayer').pagamentosAutoStore
}

function listarPagamentos() {
    const dados = getStore().loadSync() || {}
    return dados.pagamentos && typeof dados.pagamentos === 'object' ? dados.pagamentos : {}
}

function buscarPagamento(centralCode, txId) {
    const chave = chavePagamento(centralCode, txId)
    return listarPagamentos()[chave] || null
}

function salvarPagamento(centralCode, txId, dados) {
    const chave = chavePagamento(centralCode, txId)
    const anteriores = listarPagamentos()
    const atual = anteriores[chave] || {}
    const entrada = {
        ...atual,
        ...dados,
        centralCode: normalizarCodigo(centralCode),
        txId: normalizarCodigo(txId),
        atualizadoEm: Date.now()
    }
    getStore().patch(`pagamentos/${chave}`, entrada)
    return entrada
}

function pagamentoFinalizado(centralCode, txId) {
    const entrada = buscarPagamento(centralCode, txId)
    return Boolean(entrada && STATUS_FINAIS.has(entrada.status))
}

function contarPendentes(centralCode = null) {
    const central = normalizarCodigo(centralCode)
    return Object.values(listarPagamentos()).filter(p => {
        if (central && normalizarCodigo(p?.centralCode) !== central) return false
        return p?.status === STATUS.AGUARDANDO_ADMIN || p?.status === STATUS.AGUARDANDO_APP || p?.status === STATUS.ERRO
    }).length
}

function limparAntigos(dias = 30) {
    const limite = Date.now() - (Number(dias) || 30) * 24 * 60 * 60 * 1000
    const pagamentos = listarPagamentos()
    let removeu = 0
    for (const [chave, entrada] of Object.entries(pagamentos)) {
        if (Number(entrada?.atualizadoEm || 0) < limite) {
            getStore().patch(`pagamentos/${chave}`, null)
            removeu++
        }
    }
    return removeu
}

module.exports = {
    STATUS,
    normalizarCodigo,
    extrairNumeroConteudo,
    extrairPagador,
    classificarPacotes,
    selecionarPacote,
    resolverPacote,
    chavePagamento,
    listarPagamentos,
    buscarPagamento,
    salvarPagamento,
    pagamentoFinalizado,
    contarPendentes,
    limparAntigos
}
