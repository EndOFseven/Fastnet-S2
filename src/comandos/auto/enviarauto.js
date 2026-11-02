const config = require('../../../data/config.json')
const { isAdmin, isOwnerCheck } = require('../../utils/baileys')
const { obterVinculo } = require('../../auto/vinculo')
const { enfileirar, normalizarTelefone, atualizarPedido, marcarNotificado } = require('../../auto/fila')
const { parseToMB } = require('../../vendas/tracker')
const { obterTabelaMegasGrupo, buscarDadosPorPacoteNaTabela, calcularMegasPorTexto } = require('../../vendas/tabela')
const { fetchFirebase } = require('../../utils/firebaseConfig')
const { formatarCardPedido } = require('../../auto/monitor')

function formatarPacote(mb, isSaldo, saldo) {
    if (isSaldo) return `Saldo ${saldo} MT`
    if (mb >= 1024) {
        const gb = (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1).replace('.', ',')
        return `${gb} GB`
    }
    return `${Math.floor(mb)} MB`
}

function ajudaTexto(prefix) {
    return [
        '🤖 *ENVIO AUTOMÁTICO* ',
        '',
        `📤 ${prefix}enviarauto <numero> <pacote> [sim1|sim2] [valor]`,
        `💰 ${prefix}enviarauto <numero> saldo <valor> [sim1|sim2]`,
        '',
        '*Exemplos de uso:*',
        `▸ ${prefix}enviarauto 845123456 1024`,
        `▸ ${prefix}enviarauto 845123456 5120 sim2`,
        `▸ ${prefix}enviarauto 845123456 1.5GB 30`,
        `▸ ${prefix}enviarauto 845123456 saldo 100`,
        '',
        '_O bot escolhe o chip com estoque suficiente e o app envia via USSD._',
        '──────────────────'
    ].join('\n')
}

async function resolverSimOtimo(centralCode, megas, isSaldo, saldo, simForcado, forcarIgnorarEstoque, prefix, numeroRaw, primeiro) {
    if (simForcado === 0 || simForcado === 1) {
        return { slot: simForcado, nome: `SIM ${simForcado + 1} (manual)` }
    }

    try {
        const simData = await fetchFirebase(`device_pairings/${centralCode}/sim_status`)
        const telemetria = (await fetchFirebase(`device_pairings/${centralCode}/telemetria`)) || {}
        if (!simData || typeof simData !== 'object') {
            return { slot: null, nome: 'Auto (App)' }
        }

        let dadosAparelho = null
        for (const [devId, devSim] of Object.entries(simData)) {
            const tel = telemetria[devId] || {}
            const papel = String(tel.papel || '').toUpperCase()
            if (papel === 'RECEBER_PAGAMENTOS') continue
            if (devSim && (devSim.sim1 || devSim.sim2)) {
                dadosAparelho = devSim
                break
            }
        }
        if (!dadosAparelho) {
            dadosAparelho = Object.values(simData).find(d => d && (d.sim1 || d.sim2))
        }
        if (!dadosAparelho) return { slot: null, nome: 'Auto (App)' }

        const s1 = dadosAparelho.sim1 || {}
        const s2 = dadosAparelho.sim2 || {}
        const s1Megas = Number(s1.megas) || 0
        const s2Megas = Number(s2.megas) || 0
        const s1Total = (s1.total && s1.total > 0) ? s1.total : 10
        const s2Total = (s2.total && s2.total > 0) ? s2.total : 10
        const s1Usado = Number(s1.usado) || 0
        const s2Usado = Number(s2.usado) || 0
        const s1Bloqueado = Boolean(s1.bloqueadoHoje || (s1Total > 0 && s1Usado >= s1Total))
        const s2Bloqueado = Boolean(s2.bloqueadoHoje || (s2Total > 0 && s2Usado >= s2Total))

        if (isSaldo) {
            const s1Saldo = Number(s1.saldo) || 0
            const s2Saldo = Number(s2.saldo) || 0
            const s1Ok = !s1Bloqueado && (saldo <= 0 || s1Saldo >= saldo)
            const s2Ok = !s2Bloqueado && (saldo <= 0 || s2Saldo >= saldo)
            if (s1Ok && !s2Ok) return { slot: 0, nome: `SIM 1 (${s1Saldo} MT)` }
            if (!s1Ok && s2Ok) return { slot: 1, nome: `SIM 2 (${s2Saldo} MT)` }
            if (s1Ok && s2Ok) {
                return s2Saldo > s1Saldo
                    ? { slot: 1, nome: `SIM 2 (${s2Saldo} MT)` }
                    : { slot: 0, nome: `SIM 1 (${s1Saldo} MT)` }
            }
            if (!forcarIgnorarEstoque) {
                return {
                    erro: [
                        '❌ *SALDO INSUFICIENTE NOS CHIPS*',
                        `O pedido precisa de *${saldo} MT*.`,
                        '',
                        `📶 *SIM 1:* ${s1Saldo} MT (${s1Usado}/${s1Total} envios)${s1Bloqueado ? ' [Limite]' : ''}`,
                        `📶 *SIM 2:* ${s2Saldo} MT (${s2Usado}/${s2Total} envios)${s2Bloqueado ? ' [Limite]' : ''}`,
                        '',
                        '💡 _Para forçar mesmo assim, adicione *forcar* no final do comando._'
                    ].join('\n')
                }
            }
            return { slot: s2Saldo > s1Saldo ? 1 : 0, nome: `SIM ${s2Saldo > s1Saldo ? 2 : 1} (forçado)` }
        }

        const s1Ok = !s1Bloqueado && s1Megas >= megas
        const s2Ok = !s2Bloqueado && s2Megas >= megas

        if (s1Ok && !s2Ok) {
            return { slot: 0, nome: `SIM 1 (${formatarPacote(s1Megas, false, 0)})` }
        }
        if (!s1Ok && s2Ok) {
            return { slot: 1, nome: `SIM 2 (${formatarPacote(s2Megas, false, 0)})` }
        }
        if (s1Ok && s2Ok) {
            return s2Megas > s1Megas
                ? { slot: 1, nome: `SIM 2 (${formatarPacote(s2Megas, false, 0)})` }
                : { slot: 0, nome: `SIM 1 (${formatarPacote(s1Megas, false, 0)})` }
        }

        if (!forcarIgnorarEstoque && (s1Megas > 0 || s2Megas > 0 || s1Bloqueado || s2Bloqueado)) {
            return {
                erro: [
                    '❌ *ESTOQUE INSUFICIENTE NOS CHIPS*',
                    `O pedido necessita de *${formatarPacote(megas, false, 0)}*.`,
                    '',
                    `📶 *SIM 1:* ${formatarPacote(s1Megas, false, 0)} (${s1Usado}/${s1Total} envios)${s1Bloqueado ? ' [Limite atingido]' : ''}`,
                    `📶 *SIM 2:* ${formatarPacote(s2Megas, false, 0)} (${s2Usado}/${s2Total} envios)${s2Bloqueado ? ' [Limite atingido]' : ''}`,
                    '',
                    '💡 _Para enviar mesmo assim, adicione o chip ou *forcar*:_',
                    `▸ *${prefix}enviarauto ${numeroRaw} ${primeiro} sim2*`
                ].join('\n')
            }
        }

        return { slot: s2Megas > s1Megas ? 1 : 0, nome: `SIM ${s2Megas > s1Megas ? 2 : 1} (auto)` }
    } catch {
        return { slot: null, nome: 'Auto (App)' }
    }
}

async function enviarAutoHandler(sock, msg, from, sender, text) {
    const prefix = config.prefix || '.'
    const raw = String(text || '').trim()
    const semPfx = raw.startsWith(prefix) ? raw.slice(prefix.length).trimStart() : raw
    const partes = semPfx.split(/\s+/)
    const cmdSemPfx = (partes[0] || '').toLowerCase()
    const nomesValidos = ['enviarauto', 'autoenviar', 'enviarpacote']
    const nomesComPfx = nomesValidos.map(n => prefix + n)
    if (!nomesValidos.includes(cmdSemPfx) && !nomesComPfx.includes(raw.split(/\s+/)[0].toLowerCase())) return false

    if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, { text: '❌ Esse comando só funciona em grupos.' }, { quoted: msg })
        return true
    }

    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}
    if (!isOwnerCheck(sender, msg) && !isAdm) {
        await sock.sendMessage(from, { text: '❌ Só administradores do grupo ou o Dono do bot podem pedir envios automáticos.' }, { quoted: msg })
        return true
    }

    const vinculo = obterVinculo(from)
    if (!vinculo.centralCode || !vinculo.autoAtivo) {
        await sock.sendMessage(from, {
            text: [
                '❌ *Este grupo ainda não tem servidor conectado.*',
                '',
                `🔌 Use *${prefix}vincular <codigo>* para inserir o código do app.`,
                `📖 Passo a passo em *${prefix}menuauto*.`
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    const numeroRaw = partes[1] || ''
    if (!numeroRaw) {
        await sock.sendMessage(from, { text: ajudaTexto(prefix) }, { quoted: msg })
        return true
    }

    const telefone = normalizarTelefone(numeroRaw)
    if (!telefone) {
        await sock.sendMessage(from, { text: '❌ Número inválido. Informe um número de Moçambique, ex.: *845123456* ou *258845123456*.' }, { quoted: msg })
        return true
    }

    const restante = partes.slice(2)
    if (restante.length === 0) {
        await sock.sendMessage(from, { text: ajudaTexto(prefix) }, { quoted: msg })
        return true
    }

    const primeiro = restante[0]
    const isSaldo = /^saldo$/i.test(primeiro)
    const tabela = obterTabelaMegasGrupo(from)

    let megas = 0
    let saldo = 0
    let valorPago = 0
    let tipoPacote = ''
    let ussdMethod = '*162#'

    if (isSaldo) {
        const valorSaldo = parseInt(String(restante[1] || '').replace(/\D/g, ''), 10)
        if (!valorSaldo || valorSaldo <= 0) {
            await sock.sendMessage(from, { text: `❌ Falta o valor do saldo.\nEx.: *${prefix}enviarauto 845123456 saldo 100*` }, { quoted: msg })
            return true
        }
        saldo = valorSaldo
        megas = valorSaldo
        ussdMethod = '*111#'
    } else {
        const pacoteRaw = primeiro.replace(',', '.')
        const temUnidade = /(mb|gb|\bm\b|\bg\b)/i.test(pacoteRaw)
        megas = Math.round(parseToMB(pacoteRaw))

        if (tabela && (!temUnidade || megas <= 50)) {
            const porPreco = calcularMegasPorTexto(String(parseFloat(pacoteRaw)), tabela)
            if (porPreco) {
                megas = parseInt(porPreco.mb, 10)
                tipoPacote = porPreco.tipo || tipoPacote
                if (porPreco.preco) valorPago = porPreco.preco
            }
        }

        if (!megas || megas <= 0) {
            await sock.sendMessage(from, {
                text: `❌ Pacote *${primeiro}* não reconhecido.\nEx.: *${prefix}enviarauto 845123456 1024* ou *${prefix}enviarauto 845123456 1.5GB*`
            }, { quoted: msg })
            return true
        }

        const simArg = restante.find(r => /^(sim1|sim2|slot1|slot2|s1|s2)$/i.test(r))
        const forcarArg = restante.some(r => /^(forcar|force)$/i.test(r))
        const simForcado = simArg ? (/2/i.test(simArg) ? 1 : 0) : null

        const argsSemSim = restante.filter(r => !/^(sim1|sim2|slot1|slot2|s1|s2|forcar|force)$/i.test(r))
        const valorRaw = argsSemSim[1] ? String(argsSemSim[1]).replace(',', '.') : ''
        if (valorRaw && /^[\d.]+$/.test(valorRaw)) valorPago = parseFloat(valorRaw) || valorPago

        if (tabela) {
            const dadosTabela = buscarDadosPorPacoteNaTabela(megas >= 1024 ? `${(megas / 1024).toFixed(1)}GB` : `${megas}MB`, tabela)
            if (dadosTabela) {
                if (!valorPago && dadosTabela.preco) valorPago = dadosTabela.preco
                if (!tipoPacote) tipoPacote = dadosTabela.tipo || ''
            }
        }
    }

    const simArgGeral = restante.find(r => /^(sim1|sim2|slot1|slot2|s1|s2)$/i.test(r))
    const forcarArgGeral = restante.some(r => /^(forcar|force)$/i.test(r))
    const simForcadoGeral = simArgGeral ? (/2/i.test(simArgGeral) ? 1 : 0) : null

    const decisaoSim = await resolverSimOtimo(
        vinculo.centralCode,
        megas,
        isSaldo,
        saldo,
        simForcadoGeral,
        forcarArgGeral,
        prefix,
        numeroRaw,
        primeiro
    )

    if (decisaoSim && decisaoSim.erro) {
        await sock.sendMessage(from, { text: decisaoSim.erro }, { quoted: msg })
        return true
    }

    const resultado = await enfileirar({
        centralCode: vinculo.centralCode,
        grupoId: from,
        clientePhone: telefone,
        megasAmount: megas,
        saldoAmount: isSaldo ? saldo : 0,
        valorPago,
        isSaldo,
        ussdMethod,
        targetSimSlot: decisaoSim?.slot,
        simName: decisaoSim?.nome,
        tipoPacote: isSaldo ? 'Saldo' : tipoPacote,
        packageCategory: isSaldo ? 'SALDO' : '',
        solicitadoPor: sender
    })

    if (!resultado.ok) {
        await sock.sendMessage(from, { text: `❌ ${resultado.motivo}` }, { quoted: msg })
        return true
    }

    const pedido = resultado.pedido
    const cardTexto = formatarCardPedido(pedido, 'PENDENTE', null)

    try {
        const sent = await sock.sendMessage(from, { text: cardTexto }, { quoted: msg })
        if (sent && sent.key) {
            atualizarPedido(pedido.id, {
                msgKey: sent.key,
                msgId: sent.key.id
            })
            marcarNotificado(pedido.id, 'pendente')
        }
        try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }) } catch {}
    } catch (errSend) {
        console.error('[ENVIARAUTO] Erro ao enviar mensagem inicial:', errSend.message)
    }

    return true
}

enviarAutoHandler.nome = 'enviarauto'
enviarAutoHandler.name = 'enviarauto'
enviarAutoHandler.aliases = ['autoenviar', 'enviarpacote']
enviarAutoHandler.categoria = 'auto'
enviarAutoHandler.subcategoria = 'AUTOMAÇÃO'
enviarAutoHandler.descricao = 'Envia um pedido de megas para o servidor do aplicativo'
enviarAutoHandler.uso = `${config.prefix}enviarauto <numero> <pacote> [valor]`
enviarAutoHandler.apenasAdmin = true

module.exports = enviarAutoHandler
