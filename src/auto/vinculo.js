const configManager = require('../utils/configManager')
const { putFirebase, deleteFirebase, fetchFirebase } = require('../utils/firebaseConfig')

const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITOS = '23456789'

const vinculosRemotos = new Map()
let restauracaoEmAndamento = null

function registrarVinculoRemoto(grupoId, centralCode, vinculadoEm = Date.now()) {
    if (!grupoId || !centralCode) return
    const atual = vinculosRemotos.get(grupoId)
    if (!atual || vinculadoEm >= atual.vinculadoEm) {
        vinculosRemotos.set(grupoId, { centralCode, vinculadoEm })
    }
}

function removerVinculoRemoto(grupoId) {
    if (grupoId) vinculosRemotos.delete(grupoId)
}

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

function normalizarGrupoId(raw) {
    const valor = String(raw || '').trim()
    if (!valor) return ''
    if (valor.endsWith('@g.us')) return valor
    if (valor.endsWith('@g___dot___us')) return valor.replace('@g___dot___us', '@g.us')
    if (valor.endsWith('@g_us')) return valor.replace('@g_us', '@g.us')
    return ''
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
    let centralCode = entry.centralCode ? normalizarCodigo(entry.centralCode) : null
    let autoAtivo = entry.autoAtivo === true

    if (!centralCode) {
        const remoto = vinculosRemotos.get(from) || vinculosRemotos.get(key)
        if (remoto && remoto.centralCode) {
            centralCode = normalizarCodigo(remoto.centralCode)
            autoAtivo = true
            groups[key] = { ...entry, centralCode, autoAtivo: true }
            try { configManager.saveGroupConfig(true) } catch { }
            console.log(`[VINCULO] Vínculo recuperado do Firebase para ${from}: ${centralCode}`)
        }
    }

    return { centralCode, autoAtivo }
}

async function restaurarVinculosFirebase() {
    if (restauracaoEmAndamento) return restauracaoEmAndamento

    restauracaoEmAndamento = (async () => {
        const centrais = await fetchFirebase('device_pairings?shallow=true')
        if (!centrais || typeof centrais !== 'object') {
            return { ok: true, restaurados: 0 }
        }

        for (const codeRaw of Object.keys(centrais)) {
            const code = normalizarCodigo(codeRaw)
            if (!code) continue

            let vinculados = null
            try {
                vinculados = await fetchFirebase(`device_pairings/${code}/grupos_vinculados`)
            } catch {
                vinculados = null
            }
            if (!vinculados || typeof vinculados !== 'object') continue

            for (const registro of Object.values(vinculados)) {
                const grupoId = normalizarGrupoId(registro && registro.grupoId)
                if (!grupoId) continue
                const vinculadoEm = Date.parse(registro.vinculadoEm) || 0
                registrarVinculoRemoto(grupoId, code, vinculadoEm)
            }
        }

        const groups = configManager.loadGroupConfig()
        let restaurados = 0

        for (const [grupoId, info] of vinculosRemotos.entries()) {
            const key = chaveGrupo(groups, grupoId)
            const entry = groups[key] || {}
            const centralAtual = entry.centralCode ? normalizarCodigo(entry.centralCode) : null

            if (!centralAtual) {
                groups[key] = { ...entry, centralCode: info.centralCode, autoAtivo: true }
                restaurados++
            }
        }

        if (restaurados > 0) {
            configManager.saveGroupConfig(true)
            console.log(`[VINCULO] ${restaurados} vínculo(s) restaurado(s) do Firebase.`)
        }

        return { ok: true, restaurados }
    })().catch(err => {
        console.error('[VINCULO] Falha ao restaurar vínculos do Firebase:', err.message)
        return { ok: false, restaurados: 0 }
    }).finally(() => {
        restauracaoEmAndamento = null
    })

    return restauracaoEmAndamento
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
    registrarVinculoRemoto(key, codigo)
    if (key !== from) registrarVinculoRemoto(from, codigo)

    const safeKey = chaveSegura(key)
    await putFirebase(`device_pairings/${codigo}/grupos_vinculados/${safeKey}`, {
        grupoId: from,
        grupoNome: meta.grupoNome || '',
        vinculadoEm: new Date().toISOString(),
        status: 'ATIVO'
    })
    await putFirebase(`device_pairings/${codigo}/whatsapp`, {
        grupoId: from,
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
    const vinculosFirebase = (await fetchFirebase(`device_pairings/${codigo}/grupos_vinculados`)) || {}
    const jaUsado = outrosGrupos.length > 0 ||
        Object.keys(vinculosFirebase).some(k => k !== chaveSegura(key))

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
    removerVinculoRemoto(key)
    removerVinculoRemoto(from)

    if (codigo) {
        try { await deleteFirebase(`device_pairings/${codigo}/grupos_vinculados/${chaveSegura(key)}`) } catch {}
        const registro = await fetchFirebase(`device_pairings/${codigo}/whatsapp`)
        const grupoRegistrado = normalizarGrupoId(registro && registro.grupoId)
        if (grupoRegistrado === normalizarGrupoId(from) || grupoRegistrado === normalizarGrupoId(key)) {
            await deleteFirebase(`device_pairings/${codigo}/whatsapp`)
        }
    }

    return { ok: true, codigo }
}

module.exports = {
    normalizarCodigo,
    obterVinculo,
    restaurarVinculosFirebase,
    registrarVinculoRemoto,
    removerVinculoRemoto,
    vincular,
    concluirVinculo,
    desvincular,
    resolverCodigo
}
