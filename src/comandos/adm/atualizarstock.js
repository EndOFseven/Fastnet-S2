const config = require('../../../data/config.json')
const fs = require('fs')
const path = require('path')
const { isOwnerCheck, isLeaderCheck } = require('../../utils/baileys')
const { fetchFirebase, putFirebase } = require('../../utils/firebaseConfig')

const SLOTS_MEM_PATH = path.join(__dirname, '../../../data/simSlots.json')

function carregarMemSlots() {
    try { return JSON.parse(fs.readFileSync(SLOTS_MEM_PATH, 'utf8')) } catch { return {} }
}

function guardarMemSlots(mem) {
    try {
        fs.mkdirSync(path.dirname(SLOTS_MEM_PATH), { recursive: true })
        fs.writeFileSync(SLOTS_MEM_PATH, JSON.stringify(mem, null, 2))
    } catch {}
}

function versaoSuficiente(v) {
    const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/)
    if (!m) return false
    return (Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3])) >= 20322
}

// Presença de cartões por slot
function slotsDoAparelho(dados, tel) {
    if (dados && typeof dados.sim1Present === 'boolean') {
        return [dados.sim1Present, dados.sim2Present === true]
    }
    const s2 = (dados && dados.sim2) || {}
    const s2Ativo = Boolean(s2.ultimaConsultaEm || s2.validadeData || s2.validadeTimestamp) ||
        Number(s2.usado) > 0 || Number(s2.saldoTransferidoHoje) > 0
    return [true, s2Ativo]
}

function slotsEfetivos(dev, dados, tel, forcar = false) {
    if (forcar) {
        // Ao forçar, limpa o histórico de bloqueio local do aparelho para permitir nova detecção
        const mem = carregarMemSlots()
        if (mem[dev]) {
            delete mem[dev]
            guardarMemSlots(mem)
        }
        // Se o hardware do app confirmou booleanos explícitos, respeita
        if (dados && typeof dados.sim1Present === 'boolean' && typeof dados.sim2Present === 'boolean') {
            return [dados.sim1Present, dados.sim2Present]
        }
        // Caso contrário, tenta ambos os slots para testar a resposta real
        return [true, true]
    }

    const mem = carregarMemSlots()[dev]
    const detetados = slotsDoAparelho(dados, tel)
    const s = mem && mem.slots
    return [
        s && s[0] === false ? false : detetados[0],
        s && s[1] === false ? false : detetados[1]
    ]
}

function registarResultadoSlot(dev, slot, sucesso) {
    const mem = carregarMemSlots()
    const e = mem[dev] || { slots: [true, true], falhas: [0, 0] }
    e.slots = e.slots || [true, true]
    e.falhas = e.falhas || [0, 0]
    if (sucesso) {
        e.slots[slot] = true
        e.falhas[slot] = 0
    } else {
        e.falhas[slot] = (e.falhas[slot] || 0) + 1
        // Só desativa o slot se falhar 2 vezes consecutivas
        if (e.falhas[slot] >= 2) e.slots[slot] = false
    }
    mem[dev] = e
    guardarMemSlots(mem)
}

const emExecucao = new Set()
const ESPERA_CONSULTA_MS = 60000
const INTERVALO_POLL_MS = 5000
const JANELA_ONLINE_MS = 6 * 60 * 60 * 1000

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

function formatarSim(sim) {
    if (!sim || (sim.megas === undefined && sim.saldo === undefined)) return 'sem dados'
    return `${formatarMegas(sim.megas)} · ${Number(sim.saldo) || 0} MT`
}

function curto(devId) {
    return String(devId || '?').slice(0, 8)
}

function esperar(ms) {
    return new Promise(r => setTimeout(r, ms))
}

function resolverAlvos(from, args) {
    const configManager = require('../../utils/configManager')
    const groups = configManager.loadGroupConfig()
    const chave = (id) => groups[id] || groups[id.replace(/\./g, '___dot___')] || groups[id.replace(/___dot___/g, '.')] || {}

    if (from.endsWith('@g.us')) {
        const codigo = String(chave(from).centralCode || '').trim().toUpperCase()
        return codigo ? [{ codigo }] : []
    }

    const { obterMapaGrupos } = require('./aluguel')
    const jids = typeof obterMapaGrupos === 'function' ? obterMapaGrupos() : []
    
    // Se no privado indicou o número do grupo (ex: ".atualizarstock 1")
    const argDigitos = args.find(a => /\d+/.test(a))
    const idx = parseInt((argDigitos || '').replace(/\D/g, ''), 10)
    if (!isNaN(idx) && idx >= 1 && idx <= jids.length) {
        const codigo = String(chave(jids[idx - 1]).centralCode || '').trim().toUpperCase()
        return codigo ? [{ codigo }] : []
    }

    // Se estiver no privado e houver apenas 1 grupo cadastrado, seleciona-o automaticamente
    if (jids.length === 1 && !argDigitos) {
        const codigo = String(chave(jids[0]).centralCode || '').trim().toUpperCase()
        if (codigo) return [{ codigo }]
    }

    return null
}

async function listarDispositivos(raiz, codigo, forcar = false) {
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

    // Deduplicar e ignorar chaves legadas/fantasmas (ex: celular_2)
    const candidatos = []
    const deviceIdsVistos = new Set()

    // Prioriza IDs reais que constam em pairedDevices ou telemetria
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
        const isOnline = forcar ? true : Boolean(visto && (agora - visto < JANELA_ONLINE_MS))
        const modelo = tel.modelo || paired.deviceModel || ''

        // Celular exclusivo de pagamentos: NÃO recebe ordem USSD!
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
            slots: slotsEfetivos(dev, sim[dev], tel, forcar),
            papel
        }

        if (isOnline) online.push(info)
        else offline.push(info)
    }

    return { online, offline, pagamentos, sim }
}

async function executarStock(sock, msg, from, codigo, forcar = false) {
    const raiz = `device_pairings/${codigo}`
    let { online, offline, pagamentos, sim } = await listarDispositivos(raiz, codigo, forcar)

    if (online.length === 0) {
        let txt = `⚠️ *Nenhum aparelho disparador online* no servidor *${codigo}*.\n`
        if (pagamentos.length > 0) {
            txt += `\n💳 *Pagamentos (SMS):* ${pagamentos.map(p => p.modelo).join(', ')} (online, não executa USSD)`
        }
        if (offline.length > 0) {
            txt += `\n📴 *Sem ligação:* ${offline.map(d => curto(d.dev)).join(', ')}`
        }
        await sock.sendMessage(from, { text: txt }, { quoted: msg })
        return
    }

    await sock.sendMessage(from, {
        text: [
            `🔎 *A verificar o stock em ${online.length} aparelho(s) disparador(es)...*`,
            '──────────────────',
            `▸ Servidor: *${codigo}*`,
            forcar ? '▸ Modo: *FORÇADO* (re-detectando todos os SIMs)' : '▸ Modo: *Normal*',
            '▸ Consulta *100# aos cartões ativos',
            pagamentos.length > 0 ? `▸ Celular de pagamentos: *Ignorado* (${pagamentos.map(p => p.modelo).join(', ')})` : null,
            '⏳ Aguarde alguns segundos...'
        ].filter(Boolean).join('\n')
    }, { quoted: msg })

    const inicio = Date.now()
    const pedidos = []
    let n = 0

    for (const { dev, slots } of online) {
        for (let slot = 0; slot < 2; slot++) {
            if (!slots[slot]) continue
            n++
            const id = `CONSULTA-STOCK-${inicio}-${n}`
            pedidos.push({ id, dev, slot, finalizado: false, status: 'PENDENTE' })
            await putFirebase(`${raiz}/vendas_pendentes/${id}`, {
                status: 'PENDENTE',
                clientePhone: 'CONSULTA STOCK',
                megasAmount: 0,
                valorPago: 0,
                ussdMethod: '*100#',
                isConsulta: true,
                isManual: true,
                centralCode: codigo,
                targetDeviceId: dev,
                targetSimSlot: slot,
                repeticoes: 1,
                origem: 'STOCK',
                createdAt: inicio
            })
        }
    }

    if (pedidos.length === 0) {
        await sock.sendMessage(from, {
            text: `⚠️ Nenhum cartão SIM ativo encontrado nos aparelhos de *${codigo}*. Use \`.atualizarstock forcar\` para forçar a tentativa em ambos os slots.`
        }, { quoted: msg })
        return
    }

    // Polling aguardando conclusão real de TODOS os pedidos (suporte robusto a Dual SIM e múltiplos aparelhos)
    const maxTentativas = Math.ceil(ESPERA_CONSULTA_MS / INTERVALO_POLL_MS)
    for (let i = 0; i < maxTentativas; i++) {
        await esperar(INTERVALO_POLL_MS)

        let concluidos = 0
        for (const p of pedidos) {
            if (p.finalizado) {
                concluidos++
                continue
            }
            try {
                const remoto = await fetchFirebase(`${raiz}/vendas_pendentes/${p.id}`)
                if (remoto) {
                    const st = String(remoto.status || '').toUpperCase()
                    if (st === 'SUCESSO' || st === 'CONCLUIDO') {
                        p.status = 'SUCESSO'
                        p.finalizado = true
                        registarResultadoSlot(p.dev, p.slot, true)
                        concluidos++
                    } else if (st === 'FALHA') {
                        p.status = 'FALHA'
                        p.finalizado = true
                        registarResultadoSlot(p.dev, p.slot, false)
                        concluidos++
                    }
                }
            } catch {}
        }

        // Todos os SIMs completaram suas consultas
        if (concluidos >= pedidos.length) break
    }

    // Limpeza das ordens concluídas ou com timeout
    for (const p of pedidos) {
        try {
            await putFirebase(`${raiz}/vendas_pendentes/${p.id}`, null)
        } catch {}
    }

    // Busca o sim_status mais recente após todas as consultas terem terminado
    sim = (await fetchFirebase(`${raiz}/sim_status`)) || {}

    let texto = `📊 *STOCK DO SERVIDOR ${codigo}*\n──────────────────\n`
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
            : 'sem resposta'
        texto += ` 🕓 Atualizado: ${atualizado}\n──────────────────\n`
    }

    texto += `📶 *Total:* ${formatarMegas(totalMegas)} · ${totalSaldo} MT\n`

    if (pagamentos.length > 0) {
        texto += `💳 *Pagamentos:* ${pagamentos.map(p => p.modelo).join(', ')} (SMS apenas)\n`
    }
    if (offline.length > 0) {
        texto += `📴 *Offline (não verificados):* ${offline.map(d => curto(d.dev)).join(', ')}\n`
    }
    texto += `_Consulta *100# concluída. Valores reais dos chips._`

    await sock.sendMessage(from, { text: texto }, { quoted: msg })
}

module.exports = async (sock, msg, from, sender, text) => {
    const pfx = config.prefix || '.'
    const raw = String(text || '').trim()
    const clean = raw.toLowerCase()

    const stockMemoria = clean === pfx + 'stock memoria' || clean.startsWith(pfx + 'stock memoria ')
    const ehComando = clean === pfx + 'atualizarstock' || clean === pfx + 'atualizar stock' ||
        clean.startsWith(pfx + 'atualizarstock ') || clean.startsWith(pfx + 'atualizar stock ') ||
        (!stockMemoria && (clean === pfx + 'stock' || clean.startsWith(pfx + 'stock ')))
    if (!ehComando) return false

    // Extrair parâmetros de forma flexível (suporta ".atualizarstock forcar", ".atualizar stock 1 forcar", etc)
    const tokens = raw.slice(pfx.length).trim().split(/\s+/)
    const resto = []
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i].toLowerCase()
        if (i === 0 && (t === 'atualizarstock' || t === 'atualizar' || t === 'stock')) continue
        if (i === 1 && tokens[0].toLowerCase() === 'atualizar' && t === 'stock') continue
        resto.push(tokens[i])
    }

    const forcar = resto.some(a => a.toLowerCase() === 'forcar')
    const args = resto.filter(a => a.toLowerCase() !== 'forcar')

    if (!isOwnerCheck(sender, msg) && !isLeaderCheck(sender, msg)) {
        await sock.sendMessage(from, { text: '❌ Este comando é exclusivo do administrador ou líder do bot.' }, { quoted: msg })
        return true
    }

    const alvos = resolverAlvos(from, args)
    if (alvos === null) {
        await sock.sendMessage(from, {
            text: [
                '❌ Indique o grupo ou use o comando dentro do grupo do dono:',
                '',
                '• No grupo: `.atualizarstock` ou `.atualizarstock forcar`',
                '• No privado: `.atualizarstock 1` ou `.atualizarstock 1 forcar` (onde 1 é o nº do grupo da lista `.grupos`)'
            ].join('\n')
        }, { quoted: msg })
        return true
    }
    if (alvos.length === 0) {
        await sock.sendMessage(from, { text: '❌ Este grupo não tem servidor mestre vinculado. Use `.vincular` primeiro.' }, { quoted: msg })
        return true
    }

    for (const { codigo } of alvos) {
        if (emExecucao.has(codigo)) {
            await sock.sendMessage(from, { text: `⏳ Já existe uma verificação de stock em curso para *${codigo}*.` }, { quoted: msg })
            continue
        }
        emExecucao.add(codigo)
        try {
            await executarStock(sock, msg, from, codigo, forcar)
        } catch (err) {
            console.error('[STOCK] Erro:', err.message)
            await sock.sendMessage(from, { text: `❌ Falha ao verificar o stock de *${codigo}*: ${err.message}` }).catch(() => {})
        } finally {
            emExecucao.delete(codigo)
        }
    }
    return true
}
