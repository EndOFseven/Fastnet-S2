const configManager = require('../utils/configManager')
const { putFirebase, deleteFirebase, fetchFirebase } = require('../utils/firebaseConfig')

const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITOS = '23456789'

function normalizarCodigo(raw) {
    const clean = String(raw || '')
        .trim()
        .replace(/[—–－]/g, '-')
        .replace(/\s+/g, '')
        .toUpperCase()
    if (!clean) return ''
    if (clean.startsWith('S2-')) return clean
    if (clean.startsWith('VD-')) return clean
    if (clean.startsWith('S2')) return 'S2-' + clean.slice(2)
    if (clean.startsWith('VD')) return 'VD-' + clean.slice(2)
    if (/^\d{6}$/.test(clean)) return 'S2-' + clean
    return clean
}

function chaveGrupo(groups, from) {
    if (groups[from]) return from
    const safe = String(from).replace(/\./g, '___dot___')
    if (groups[safe]) return safe
    return from
}

function chaveSegura(jid) {
    return String(jid || '').replace(/[.#$/\[\]]/g, '_')
}

function gerarCodigo4() {
    const todos = LETRAS + DIGITOS
    for (;;) {
        let c = ''
        for (let i = 0; i < 4; i++) c += todos[Math.floor(Math.random() * todos.length)]
        if (/[A-Z]/.test(c) && /\d/.test(c)) return c
    }
}

function obterVinculo(from) {
    const groups = configManager.loadGroupConfig()
    const key = chaveGrupo(groups, from)
    const entry = groups[key] || {}
    return {
        centralCode: entry.centralCode ? normalizarCodigo(entry.centralCode) : null,
        autoAtivo: entry.autoAtivo === true
    }
}

async function resolverCodigo(raw) {
    const codigo = normalizarCodigo(raw)
    if (!codigo) return ''
    const licenca = await fetchFirebase(`app_licenses/${codigo}`)
    if (licenca && licenca.centralCode) return normalizarCodigo(licenca.centralCode)
    if (licenca) return codigo
    const pareamento = await fetchFirebase(`device_pairings/${codigo}`)
    if (pareamento) return codigo
    return ''
}

async function concluirVinculo(from, codigo, meta = {}) {
    const groups = configManager.loadGroupConfig()
    const key = chaveGrupo(groups, from)
    groups[key] = groups[key] || {}
    groups[key].centralCode = codigo
    groups[key].autoAtivo = true
    configManager.saveGroupConfig(true)

    const safeKey = chaveSegura(key)
    await putFirebase(`device_pairings/${codigo}/grupos_vinculados/${safeKey}`, {
        grupoId: key,
        grupoNome: meta.grupoNome || '',
        vinculadoEm: new Date().toISOString(),
        status: 'ATIVO'
    })
    await putFirebase(`device_pairings/${codigo}/whatsapp`, {
        grupoId: key,
        grupoNome: meta.grupoNome || '',
        status: 'ATIVO',
        vinculadoEm: new Date().toISOString()
    })
    return { ok: true, codigo }
}

async function vincular(from, codigoRaw, meta = {}) {
    const codigo = await resolverCodigo(codigoRaw)
    if (!codigo || codigo.length < 3 || codigo.length > 40) {
        return { ok: false, motivo: 'Código não encontrado. Confirme no app FastNet S2 o código do servidor e tente de novo.' }
    }

    const groups = configManager.loadGroupConfig()
    const key = chaveGrupo(groups, from)

    const outrosGrupos = Object.entries(groups)
        .filter(([k, e]) => k !== key && e && String(e.centralCode || '').trim().toUpperCase() === codigo)
    const vinculosRemotos = (await fetchFirebase(`device_pairings/${codigo}/grupos_vinculados`)) || {}
    const jaUsado = outrosGrupos.length > 0 ||
        Object.keys(vinculosRemotos).some(k => k !== chaveSegura(key))

    if (jaUsado && !meta.confirmado) {
        const codigo4 = gerarCodigo4()
        const requestKey = chaveSegura(key)
        await putFirebase(`device_pairings/${codigo}/group_requests/${requestKey}`, {
            requestId: requestKey,
            groupId: key,
            groupName: meta.grupoNome || '',
            requestedBy: meta.solicitadoPor || '',
            requestedByName: meta.solicitadoPorNome || '',
            codigo4,
            status: 'PENDENTE',
            timestamp: Date.now()
        })
        return { ok: true, aguardandoConfirmacao: true, codigo, codigo4, requestKey }
    }

    return concluirVinculo(key, codigo, meta)
}

async function desvincular(from) {
    const groups = configManager.loadGroupConfig()
    const key = chaveGrupo(groups, from)
    const entry = groups[key] || {}
    const codigo = entry.centralCode ? normalizarCodigo(entry.centralCode) : null

    delete entry.centralCode
    entry.autoAtivo = false
    groups[key] = entry
    configManager.saveGroupConfig(true)

    if (codigo) {
        try { await deleteFirebase(`device_pairings/${codigo}/grupos_vinculados/${chaveSegura(key)}`) } catch {}
        const registro = await fetchFirebase(`device_pairings/${codigo}/whatsapp`)
        if (registro && registro.grupoId === key) {
            await deleteFirebase(`device_pairings/${codigo}/whatsapp`)
        }
    }

    return { ok: true, codigo }
}

module.exports = {
    normalizarCodigo,
    obterVinculo,
    vincular,
    concluirVinculo,
    desvincular,
    resolverCodigo
}
