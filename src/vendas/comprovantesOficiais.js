const { fetchFirebase, patchFirebase, putFirebase, deleteFirebase } = require('../utils/firebaseConfig')
const assinaturaOficial = require('./assinaturaOficial')

const JANELA_VALIDADE_MS = 60 * 60 * 1000
const STATUS_INUTILIZAVEIS = ['UTILIZADO', 'PROCESSADO', 'USADO', 'CONSUMIDO']
const PALAVRAS_INVALIDAS = new Set([
    'CONFIRMADO', 'MPESA', 'M-PESA', 'EMOLA', 'E-MOLA', 'VODACOM', 'MOVITEL',
    'TRANSFERISTE', 'RECEBEU', 'RECEBESTE', 'RECEBIDO', 'CREDITADO', 'SALDO',
    'METICAIS', 'TRANSACAO', 'TRANSACCAO', 'REFERENCIA', 'PAGAMENTO', 'COMPRA'
])

const emVerificacao = new Set()

function normalizarCodigo(codigo) {
    return String(codigo || '').trim().toUpperCase()
}

function chaveOficial(codigo) {
    return normalizarCodigo(codigo).replace(/[.#$\[\]/]/g, '_')
}

function codigoSuspeito(codigo) {
    const c = normalizarCodigo(codigo)
    if (c.length < 6) return true
    if (PALAVRAS_INVALIDAS.has(c)) return true
    return !/\d/.test(c)
}

function caminhosOficiais(codigo, centralCode) {
    const key = chaveOficial(codigo)
    const central = normalizarCodigo(centralCode)
    const caminhos = []
    if (central) caminhos.push(`device_pairings/${central}/comprovantes_oficiais/${key}`)
    caminhos.push(`comprovantes_oficiais/${key}`)
    return caminhos
}

async function buscarOficial(codigo, centralCode) {
    const alvo = normalizarCodigo(codigo)
    let semAssinatura = null
    let valido = null
    let usado = null

    for (const caminho of caminhosOficiais(codigo, centralCode)) {
        let dados = null
        try {
            dados = await fetchFirebase(caminho)
        } catch {
            dados = null
        }
        if (!dados || typeof dados !== 'object') continue
        const tx = normalizarCodigo(dados.tx_id)
        if (!tx || tx !== alvo) continue

        const registro = { ...dados, caminho }
        const assinaturaValida = assinaturaOficial.assinaturaValida(registro)
        const status = normalizarCodigo(registro.status)

        if (STATUS_INUTILIZAVEIS.includes(status)) {
            if (!usado || (assinaturaValida && !usado.assinaturaValida)) {
                usado = { ...registro, assinaturaValida }
            }
            continue
        }

        if (assinaturaValida) {
            if (!valido) valido = { ...registro, assinaturaValida: true }
            continue
        }

        if (!semAssinatura) semAssinatura = { ...registro, assinaturaValida: false }
    }

    return usado || valido || semAssinatura
}

async function verificar({ codigo, valorEsperado, centralCode, marcar = true }) {
    if (!codigo || codigoSuspeito(codigo)) {
        return { aprovado: false, aguardar: false, motivo: 'codigo_invalido' }
    }

    const key = chaveOficial(codigo)
    if (emVerificacao.has(key)) {
        return { aprovado: false, aguardar: false, motivo: 'em_processamento' }
    }
    emVerificacao.add(key)

    try {
        const oficial = await buscarOficial(codigo, centralCode)
        if (!oficial) {
            return { aprovado: false, aguardar: true, motivo: 'sem_sms_oficial' }
        }

        const status = normalizarCodigo(oficial.status)
        if (STATUS_INUTILIZAVEIS.includes(status)) {
            return { aprovado: false, aguardar: false, motivo: 'codigo_reutilizado', oficial }
        }

        if (!oficial.assinaturaValida) {
            if (String(oficial.signature || '').trim()) {
                return { aprovado: false, aguardar: false, motivo: 'assinatura_invalida', oficial }
            }
            return { aprovado: false, aguardar: true, motivo: 'sms_sem_assinatura', oficial }
        }

        if (status !== 'DISPONIVEL') {
            return { aprovado: false, aguardar: false, motivo: 'sms_indisponivel', oficial }
        }

        const timestamp = Number(oficial.timestamp) || 0
        if (!timestamp || (Date.now() - timestamp) > JANELA_VALIDADE_MS) {
            return { aprovado: false, aguardar: false, motivo: 'sms_desatualizado', oficial }
        }

        const valorOficial = Number(oficial.amount_mt)
        if (!(valorOficial > 0)) {
            return { aprovado: false, aguardar: false, motivo: 'sms_sem_valor', oficial }
        }

        if (Math.abs(valorOficial - Number(valorEsperado || 0)) > 0.01) {
            return { aprovado: false, aguardar: false, motivo: 'valor_divergente', oficial, valorOficial }
        }

        if (marcar) await marcarUtilizado(codigo, centralCode, 'bot-sms')
        return { aprovado: true, oficial }
    } finally {
        emVerificacao.delete(key)
    }
}

async function registrarEspera({ codigo, centralCode, valor, grupoId, clienteId, clienteNome }) {
    if (!codigo) return false
    return putFirebase(`pendentes_verificacao/${chaveOficial(codigo)}`, {
        tx_id: normalizarCodigo(codigo),
        valor: Number(valor) || 0,
        grupoId: grupoId || '',
        clienteId: clienteId || '',
        clienteNome: clienteNome || '',
        centralCode: normalizarCodigo(centralCode),
        status: 'AGUARDANDO_SMS',
        criadoEm: Date.now()
    })
}

async function marcarUtilizado(codigo, centralCode, por = 'bot-sms') {
    if (!codigo) return
    const key = chaveOficial(codigo)
    const central = normalizarCodigo(centralCode)
    const alvos = [`comprovantes_oficiais/${key}`, `comprovantes_sms/${key}`]
    if (central) alvos.push(`device_pairings/${central}/comprovantes_oficiais/${key}`)

    for (const caminho of alvos) {
        let atual = null
        try {
            atual = await fetchFirebase(caminho)
        } catch {
            atual = null
        }
        if (!atual || typeof atual !== 'object') continue
        try {
            await patchFirebase(caminho, {
                status: 'UTILIZADO',
                utilizadoPor: por,
                utilizadoEm: new Date().toISOString()
            })
        } catch { }
    }
}

async function limparEspera(codigo) {
    if (!codigo) return false
    try {
        return await deleteFirebase(`pendentes_verificacao/${chaveOficial(codigo)}`)
    } catch {
        return false
    }
}

module.exports = {
    JANELA_VALIDADE_MS,
    normalizarCodigo,
    chaveOficial,
    codigoSuspeito,
    buscarOficial,
    verificar,
    registrarEspera,
    marcarUtilizado,
    limparEspera
}
