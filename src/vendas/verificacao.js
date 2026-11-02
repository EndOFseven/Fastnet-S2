const { verificacoesStore } = require('../utils/firebaseDataLayer')
const configManager = require('../utils/configManager')

const MODOS = ['firebase', 'manual', 'auto']
const MODO_PADRAO = 'firebase'
const VALIDADE_PENDENTE_MS = 24 * 60 * 60 * 1000

function load() {
    const data = verificacoesStore.loadSync() || {}
    if (!data.pendentes || typeof data.pendentes !== 'object') data.pendentes = {}
    return data
}

function chaveGrupo(groupId) {
    return String(groupId || '').replace(/[.#$/\[\]]/g, '_')
}

function chaveCodigo(codigo) {
    return String(codigo || '').trim().toUpperCase().replace(/[.#$/\[\]]/g, '_')
}

function getModo(groupId) {
    try {
        const cfg = configManager.loadGroupConfig()
        const entry = cfg[groupId] || cfg[chaveGrupo(groupId)] || {}
        const modo = String(entry.verificacaoComprovante || MODO_PADRAO).trim().toLowerCase()
        return MODOS.includes(modo) ? modo : MODO_PADRAO
    } catch {
        return MODO_PADRAO
    }
}

function setModo(groupId, modo) {
    const m = String(modo || '').trim().toLowerCase()
    if (!MODOS.includes(m) || !groupId) return false
    const cfg = configManager.loadGroupConfig()
    const chave = cfg[groupId] ? groupId : chaveGrupo(groupId)
    if (!cfg[chave]) cfg[chave] = {}
    cfg[chave].verificacaoComprovante = m
    configManager.saveGroupConfig(true)
    return true
}

function textoMotivos(motivos = []) {
    const mapa = {
        sem_sms_oficial: 'pagamento ainda não localizado no SMS oficial da operadora',
        codigo_reutilizado: 'comprovativo já utilizado',
        sms_desatualizado: 'pagamento fora do prazo de validação (1 hora)',
        valor_divergente: 'valor recebido diferente do comprovativo',
        codigo_invalido: 'código sem formato de transação real',
        sms_sem_valor: 'SMS oficial sem valor identificado',
        sms_indisponivel: 'SMS oficial já utilizado',
        assinatura_invalida: 'assinatura oficial inválida',
        app_desatualizado: 'comprovativo gravado por app desatualizado (sem assinatura oficial)',
        modo_manual: 'confirmação manual ativada no grupo',
        pagamento_nao_confirmado: 'pagamento não confirmado pela operadora'
    }
    const lista = [...new Set(motivos)].map(m => mapa[m]).filter(Boolean)
    return lista.length > 0 ? lista.join(' • ') : 'verificação automática'
}

function salvarPendente(dados = {}) {
    if (!dados.codigo || !dados.grupoId) return null
    const data = load()
    const key = chaveCodigo(dados.codigo)
    const entrada = {
        ...dados,
        codigo: String(dados.codigo).trim().toUpperCase(),
        codigoKey: key,
        status: dados.status || 'AGUARDANDO_ADMIN',
        criadoEm: Date.now()
    }
    data.pendentes[key] = entrada
    verificacoesStore.save(data)
    return entrada
}

function buscarPendente(groupId, codigo) {
    if (!codigo) return null
    const data = load()
    const item = data.pendentes[chaveCodigo(codigo)]
    if (!item) return null
    if (groupId && item.grupoId !== groupId) return null
    return item
}

function removerPendente(codigo) {
    if (!codigo) return
    const data = load()
    const key = chaveCodigo(codigo)
    if (!data.pendentes[key]) return
    delete data.pendentes[key]
    verificacoesStore.save(data)
}

function listarPendentes(groupId) {
    const data = load()
    return Object.values(data.pendentes)
        .filter(p => p && (!groupId || p.grupoId === groupId))
        .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0))
}

function limparPendentesAntigos() {
    const data = load()
    const agora = Date.now()
    let removeu = 0
    for (const [key, item] of Object.entries(data.pendentes)) {
        const criadoEm = Number(item?.criadoEm) || 0
        if (!criadoEm || (agora - criadoEm > VALIDADE_PENDENTE_MS)) {
            delete data.pendentes[key]
            removeu++
        }
    }
    if (removeu > 0) {
        verificacoesStore.save(data)
        console.log(`[VERIFICACAO] 🧹 ${removeu} comprovativo(s) pendente(s) expirado(s) removido(s).`)
    }
}

setInterval(limparPendentesAntigos, 30 * 60 * 1000)

module.exports = {
    MODOS,
    MODO_PADRAO,
    getModo,
    setModo,
    textoMotivos,
    salvarPendente,
    buscarPendente,
    removerPendente,
    listarPendentes,
    limparPendentesAntigos
}
