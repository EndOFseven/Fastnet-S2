const config = require('../../../data/config.json')
const fs = require('fs')
const path = require('path')
const { isOwnerCheck, isLeaderCheck, isAdmin } = require('../../utils/baileys')
const { fetchFirebase } = require('../../utils/firebaseConfig')

const SLOTS_MEM_PATH = path.join(__dirname, '../../../data/simSlots.json')
const JANELA_ONLINE_MS = 6 * 60 * 60 * 1000

function carregarMemSlots() {
    try { return JSON.parse(fs.readFileSync(SLOTS_MEM_PATH, 'utf8')) } catch { return {} }
}

function slotsDoAparelho(dados, tel) {
    if (dados && typeof dados.sim1Present === 'boolean') {
        return [dados.sim1Present, dados.sim2Present === true]
    }
    const s2 = (dados && dados.sim2) || {}
    const s2Ativo = Boolean(s2.ultimaConsultaEm || s2.validadeData || s2.validadeTimestamp) ||
        Number(s2.usado) > 0 || Number(s2.saldoTransferidoHoje) > 0
    return [true, s2Ativo]
}

function slotsEfetivos(dev, dados, tel) {
    const mem = carregarMemSlots()[dev]
    const detetados = slotsDoAparelho(dados, tel)
    const s = mem && mem.slots
    return [
        s && s[0] === false ? false : detetados[0],
        s && s[1] === false ? false : detetados[1]
    ]
}

function formatarMegas(mb) {
    const n = Number(mb) || 0
    if (n >= 1024) {
        const gb = n / 1024
        return (Number.isInteger(gb) ? gb : gb.toFixed(1)) + ' GB'
    }
    return Math.round(n) + ' MB'
}

function formatarLinhaSim(s, slotPresente) {
    if (!slotPresente) return 'sem cartão'
    if (!s || (s.megas === undefined && s.saldo === undefined)) return 'sem dados'
    const megasSaldo = `${formatarMegas(s.megas)} · ${Number(s.saldo) || 0} MT`
    const total = (Number(s.total) > 0) ? Number(s.total) : 10
    const usado = Math.max(0, Number(s.usado) || 0)
    const restante = Math.max(0, total - usado)
    const bloqueado = Boolean(s.bloqueadoHoje || (restante === 0))
    const statusEnvios = bloqueado
        ? `Envios: *${usado}/${total}* feitos • *0 restantes* (⚠️ Limite diário)`
        : `Envios: *${usado}/${total}* feitos • *${restante}* restantes`
    return `${megasSaldo}\n   ↳ ${statusEnvios}`
}

function curto(devId) {
    return String(devId || '?').slice(0, 8)
}

function resolverCodigo(from, args) {
    const configManager = require('../../utils/configManager')
    const groups = configManager.loadGroupConfig()
    const chave = (id) => groups[id] || groups[id.replace(/\./g, '___dot___')] || groups[id.replace(/___dot___/g, '.')] || {}

    if (from.endsWith('@g.us')) {
        const codigo = String(chave(from).centralCode || '').trim().toUpperCase()
        return codigo || null
    }

    const { obterMapaGrupos } = require('./aluguel')
    const jids = typeof obterMapaGrupos === 'function' ? obterMapaGrupos() : []
    const argDigitos = args.find(a => /\d+/.test(a))
    const idx = parseInt((argDigitos || '').replace(/\D/g, ''), 10)
    if (!isNaN(idx) && idx >= 1 && idx <= jids.length) {
        return String(chave(jids[idx - 1]).centralCode || '').trim().toUpperCase() || null
    }
    if (jids.length === 1 && !argDigitos) {
        return String(chave(jids[0]).centralCode || '').trim().toUpperCase() || null
    }
    return undefined
}

module.exports = async (sock, msg, from, sender, text) => {
    const pfx = config.prefix || '.'
    const raw = String(text || '').trim()
    const clean = raw.toLowerCase()
    const comMemoria = clean === pfx + 'stockmemoria' || clean.startsWith(pfx + 'stockmemoria ')
    const comAlias = clean === pfx + 'stockm' || clean.startsWith(pfx + 'stockm ')
    const comEspaco = clean === pfx + 'stock memoria' || clean.startsWith(pfx + 'stock memoria ')
    if (!comMemoria && !comAlias && !comEspaco) return false

    const isOwner = isOwnerCheck(sender, msg)
    const isLeader = isLeaderCheck(sender, msg)
    let isAdminGrupo = false
    if (from.endsWith('@g.us')) {
        try { isAdminGrupo = await isAdmin(sock, from, sender) } catch {}
    }
    if (!isOwner && !isLeader && !isAdminGrupo) {
        await sock.sendMessage(from, { text: '❌ Este comando é exclusivo dos administradores.' }, { quoted: msg })
        return true
    }

    const args = raw.split(/\s+/).slice(comEspaco ? 2 : 1)
    const codigo = resolverCodigo(from, args)
    if (codigo === undefined) {
        await sock.sendMessage(from, {
            text: [
                '❌ Use este comando *dentro do grupo* ou indique o grupo:',
                '',
                '• `.stockm`, `.stockmemoria` ou `.stock memoria` (no grupo)',
                '• `.stockm 1` ou `.stock memoria 1` (grupo nº 1 da lista `.grupos`)'
            ].join('\n')
        }, { quoted: msg })
        return true
    }
    if (codigo === null) {
        await sock.sendMessage(from, { text: '❌ Este grupo não tem servidor mestre vinculado. Use `.vincular` primeiro.' }, { quoted: msg })
        return true
    }

    try {
        const raiz = `device_pairings/${codigo}`
        const telemetria = (await fetchFirebase(`${raiz}/telemetria`)) || {}
        const sim = (await fetchFirebase(`${raiz}/sim_status`)) || {}
        const masters = (await fetchFirebase('device_masters')) || {}
        const pairedDevices = (await fetchFirebase(`${raiz}/paired_devices`)) || {}

        const rawCandidatos = new Set([
            ...Object.keys(telemetria),
            ...Object.keys(sim),
            ...Object.keys(masters).filter(d => String(masters[d]).trim().toUpperCase() === codigo),
            ...Object.keys(pairedDevices)
        ])

        const candidatos = []
        const deviceIdsVistos = new Set()

        const ordenados = Array.from(rawCandidatos).sort((a, b) => {
            const aReal = pairedDevices[a] || telemetria[a] ? 1 : 0
            const bReal = pairedDevices[b] || telemetria[b] ? 1 : 0
            if (aReal !== bReal) return bReal - aReal
            const aAlias = /^celular_\d+/i.test(a) ? 1 : 0
            const bAlias = /^celular_\d+/i.test(b) ? 1 : 0
            return aAlias - bAlias
        })

        for (const dev of ordenados) {
            const realId = sim[dev]?.deviceId || telemetria[dev]?.deviceId || pairedDevices[dev]?.deviceId || dev
            if (deviceIdsVistos.has(realId)) continue
            if (/^celular_\d+/i.test(dev) && !pairedDevices[dev] && !telemetria[dev]) continue
            deviceIdsVistos.add(realId)
            candidatos.push(dev)
        }

        const agora = Date.now()
        const online = []
        const offline = []
        const pagamentos = []

        for (const dev of candidatos) {
            const tel = telemetria[dev] || {}
            const paired = pairedDevices[dev] || {}
            const papel = String(tel.papel || paired.deviceRole || '').trim().toUpperCase()
            const visto = Date.parse(tel.atualizadoEm || sim[dev]?.atualizadoEm || '')
            const isOnline = Boolean(visto && (agora - visto < JANELA_ONLINE_MS))
            const modelo = tel.modelo || paired.deviceModel || ''

            if (papel === 'RECEBER_PAGAMENTOS') {
                if (isOnline) {
                    pagamentos.push({ dev, modelo: modelo || curto(dev), papel })
                }
                continue
            }

            const info = {
                dev,
                visto: isNaN(visto) ? 0 : visto,
                modelo: modelo || curto(dev),
                slots: slotsEfetivos(dev, sim[dev], tel),
                papel
            }

            if (isOnline) online.push(info)
            else offline.push(info)
        }

        if (online.length === 0) {
            let txt = `⚠️ *Nenhum aparelho disparador online* no servidor *${codigo}*.\n`
            if (pagamentos.length > 0) {
                txt += `\n💳 *Pagamentos (SMS):* ${pagamentos.map(p => p.modelo).join(', ')} (online, sem estoque)`
            }
            if (offline.length > 0) txt += `\n📴 Sem ligação: ${offline.map(d => curto(d.dev)).join(', ')}`
            await sock.sendMessage(from, { text: txt }, { quoted: msg })
            return true
        }

        let texto = `📊 *STOCK GUARDADO* (${codigo})\n──────────────────\n`
        let totalMegas = 0
        let totalSaldo = 0

        for (const { dev, modelo, slots } of online) {
            const dados = sim[dev] || {}
            const s1 = dados.sim1 || {}
            const s2 = dados.sim2 || {}
            totalMegas += (Number(s1.megas) || 0) + (Number(s2.megas) || 0)
            totalSaldo += (Number(s1.saldo) || 0) + (Number(s2.saldo) || 0)

            texto += `📱 *Disparador:* ${modelo}\n`
            texto += ` ▸ SIM 1: ${formatarLinhaSim(s1, slots[0])}\n`
            texto += ` ▸ SIM 2: ${formatarLinhaSim(s2, slots[1])}\n`
            const validades = [s1.validadeData, s2.validadeData].filter(Boolean)
            if (validades.length > 0) texto += ` 📅 Validade: ${[...new Set(validades)].join(' / ')}\n`
            const atualizado = dados.atualizadoEm
                ? new Date(dados.atualizadoEm).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' })
                : 'sem dados'
            texto += ` 🕓 Última leitura: ${atualizado}\n──────────────────\n`
        }

        texto += `📶 *Total guardado:* ${formatarMegas(totalMegas)} · ${totalSaldo} MT\n`
        if (pagamentos.length > 0) {
            texto += `💳 *Pagamentos:* ${pagamentos.map(p => p.modelo).join(', ')} (SMS apenas)\n`
        }
        if (offline.length > 0) {
            texto += `📴 *Offline:* ${offline.map(d => curto(d.dev)).join(', ')}\n`
        }
        texto += '_Dados guardados (sem consulta USSD). Para actualizar: `.atualizarstock`._'

        await sock.sendMessage(from, { text: texto }, { quoted: msg })
    } catch (err) {
        console.error('[STOCK-MEMORIA] Erro:', err.message)
        await sock.sendMessage(from, { text: '❌ Falha ao ler o stock guardado.' }).catch(() => {})
    }
    return true
}
