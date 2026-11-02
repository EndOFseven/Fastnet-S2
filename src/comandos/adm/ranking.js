const path = require('path')
const fs = require('fs')
const config = require('../../../data/config.json')
const { getRanking, getClienteStats, formatMB } = require('../../vendas/tracker')
const { getGrupoConfig, setRankingAtivo, isRankingAtivo } = require('../../vendas/gruposConfig')
const { isOwnerCheck, isAdmin } = require('../../utils/baileys')
const { formatarComandoIncorreto } = require('../../utils/mensagemHelper')
const { loadMapeamento } = require(path.join(__dirname, '../../bot/core.js'))

module.exports = async function(sock, msg, from, sender, text) {
    const rawTokens = text.trim().split(/\s+/)
    const rawCmd = rawTokens[0].toLowerCase()
    const prefix = config.prefix

    const isRankingCmd = (
        rawCmd === prefix + 'ranking' ||
        rawCmd === prefix + 'rank' ||
        rawCmd === prefix + 'meuranking' ||
        rawCmd === prefix + 'meuposto' ||
        rawCmd === prefix + 'top' ||
        rawCmd === prefix + 'top10' ||
        rawCmd === prefix + 'top20' ||
        rawCmd === prefix + 'top50' ||
        rawCmd === prefix + 'clientes' ||
        rawCmd === prefix + 'topclientes' ||
        rawCmd === prefix + 'placar'
    )

    if (!isRankingCmd) return false

    const isGroup = from.endsWith('@g.us')
    if (!isGroup) {
        await sock.sendMessage(from, {
            text: '❌ *O ranking funciona apenas dentro de grupos.*'
        }, { quoted: msg })
        return true
    }

    const isOwner = isOwnerCheck(sender, msg)
    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}

    const subCmd = (rawTokens[1] || '').toLowerCase()

    if (subCmd === 'on' || subCmd === 'ativar' || subCmd === 'ligar') {
        if (!isOwner && !isAdm) {
            await sock.sendMessage(from, { text: '❌ Só administradores ativam o ranking.' }, { quoted: msg })
            return true
        }
        setRankingAtivo(from, true)
        await sock.sendMessage(from, {
            text: [
                '✅ *SISTEMA DE RANKING ATIVADO*',
                '────────────────────────',
                'O ranking deste grupo entrou em operação para vendas manuais e automáticas.',
                '',
                '📌 *Como funciona:*',
                '• Cada compra confirmada atualiza o ranking e avisa o cliente da sua posição.',
                '• Cada membro vê sua posição com `.ranking`.',
                '• A lista geral aparece com `.ranking geral` ou `.clientes`.'
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    if (subCmd === 'off' || subCmd === 'desativar' || subCmd === 'desligar') {
        if (!isOwner && !isAdm) {
            await sock.sendMessage(from, { text: '❌ Só administradores desativam o ranking.' }, { quoted: msg })
            return true
        }
        setRankingAtivo(from, false)
        await sock.sendMessage(from, {
            text: [
                '❌ *SISTEMA DE RANKING DESATIVADO*',
                '────────────────────────',
                'O ranking deste grupo ficou pausado temporariamente.',
                '',
                '💡 _Para religar a qualquer momento, um administrador deve usar:_ `.ranking on`'
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    if (subCmd === 'status') {
        const rankingAtivo = isRankingAtivo(from)
        const rankingList = getRanking(from, 1000)
        let totalMbGrupo = 0
        let totalSaldoGrupo = 0
        for (const c of rankingList) {
            totalMbGrupo += (c.totalMB || 0)
            totalSaldoGrupo += (c.totalSaldo || 0)
        }

        await sock.sendMessage(from, {
            text: [
                '📊 *STATUS DO SISTEMA DE RANKING*',
                '────────────────────────',
                `⚡ *Situação:* ${rankingAtivo ? '✅ ATIVO' : '❌ DESATIVADO'}`,
                `👥 *Clientes no ranking:* ${rankingList.length}`,
                `💾 *Total em Megas:* ${formatMB(totalMbGrupo)}`,
                `💰 *Total em Saldo:* ${totalSaldoGrupo.toFixed(2)} MT`,
                '────────────────────────',
                `💡 _Atalhos: \`${prefix}ranking on\` | \`${prefix}ranking off\` | \`${prefix}ranking geral\`_`
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    const isRankingGeral = (
        rawCmd === prefix + 'clientes' ||
        rawCmd === prefix + 'topclientes' ||
        rawCmd === prefix + 'top' ||
        rawCmd === prefix + 'top10' ||
        rawCmd === prefix + 'top20' ||
        rawCmd === prefix + 'top50' ||
        rawCmd === prefix + 'placar' ||
        subCmd === 'geral' ||
        subCmd === 'top' ||
        subCmd === 'todos' ||
        subCmd === 'lista' ||
        subCmd === 'list'
    )

    if (isRankingGeral) {
        if (!isRankingAtivo(from) && !isOwner && !isAdm) {
            await sock.sendMessage(from, {
                text: '❌ *Os administradores desativaram o ranking deste grupo.*'
            }, { quoted: msg })
            return true
        }

        const ranking = getRanking(from, 25)
        if (ranking.length === 0) {
            const avisoSemVendas = [
                '🪐 *RANKING DE CLIENTES* ',
                '──────────────────',
                '',
                '*📉 SEM VENDAS REGISTRADAS*',
                '▸  Nenhuma venda registrada neste grupo até agora.',
                '──────────────────'
            ].join('\n')
            await sock.sendMessage(from, { text: avisoSemVendas }, { quoted: msg })
            return true
        }

        const mapeamento = loadMapeamento()
        const header = [
            '🪐 *RANKING DE CLIENTES* ',
            '🏆 Clientes com maior volume',
            '──────────────────'
        ].join('\n')

        const cards = []
        const maxExibir = Math.min(ranking.length, 12)
        for (let i = 0; i < maxExibir; i++) {
            const cliente = ranking[i]
            const posicao = i + 1
            const medalha = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `${posicao}.`))
            const numero = cliente.id.split('@')[0].split(':')[0]

            let totalGB = ''
            if (cliente.totalMB >= 1024) {
                totalGB = (cliente.totalMB / 1024).toFixed(2) + ' GB'
            } else {
                totalGB = cliente.totalMB.toFixed(0) + ' MB'
            }

            let nomeExibicao = mapeamento[numero]?.nome || (cliente.nome !== '---' && cliente.nome ? cliente.nome : `@${numero}`)
            const card = [
                `*${medalha} ${posicao}º LUGAR • ${nomeExibicao.toUpperCase()}*`,
                `▸  *Volume:* ${totalGB}`,
                cliente.totalSaldo > 0 ? `▸  *Saldo:* ${cliente.totalSaldo} MT` : null,
                `▸  *Pedidos:* ${cliente.compras} compra(s)`,
                `▸  *Contato:* @${numero}`,
                '──────────────────'
            ].filter(Boolean).join('\n')

            cards.push(card)
        }

        const footer = [
            '*💡 SUA POSIÇÃO*',
            `▸  Veja a sua digitando: ${prefix}ranking`,
            '──────────────────'
        ].join('\n')

        const finalMsg = [header, ...cards, footer].join('\n\n')
        await sock.sendMessage(from, {
            text: finalMsg,
            mentions: ranking.map(r => r.id)
        }, { quoted: msg })
        return true
    }

    if (!isRankingAtivo(from) && !isOwner && !isAdm) {
        const errText = formatarComandoIncorreto(
            'O ranking deste grupo está desativado pelos administradores.',
            `${prefix}ranking on`
        )
        await sock.sendMessage(from, { text: errText }, { quoted: msg })
        return true
    }

    let targetJid = sender
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo
    if (mentions.length > 0) {
        targetJid = mentions[0]
    } else if (quotedMsg?.participant) {
        targetJid = quotedMsg.participant
    } else if (subCmd && /^\d+$/.test(subCmd)) {
        targetJid = subCmd + '@s.whatsapp.net'
    }

    const stats = getClienteStats(from, targetJid)
    const targetNumber = targetJid.split('@')[0].split(':')[0]
    const isSelf = (targetJid === sender)

    if (!stats || (stats.totalMB === 0 && stats.totalSaldo === 0 && stats.compras === 0)) {
        const msgVazio = [
            '🪐 *MEU RANKING* ',
            `👤 Cliente: @${targetNumber}`,
            '──────────────────',
            '',
            '*📉 SEM COMPRAS*',
            `▸  ${isSelf ? 'Você ainda não tem compras registradas neste grupo.' : 'Este usuário ainda não tem compras no ranking.'}`,
            '──────────────────'
        ].join('\n')

        await sock.sendMessage(from, {
            text: msgVazio,
            mentions: [targetJid]
        }, { quoted: msg })
        return true
    }

    const topNomeMB = stats.topClienteMBNome ? ` (${stats.topClienteMBNome})` : ''
    const topNomeSaldo = stats.topClienteSaldoNome ? ` (${stats.topClienteSaldoNome})` : ''

    const headerInd = [
        '🪐 *MEU RANKING* ',
        `👤 Cliente: @${targetNumber}`,
        '──────────────────'
    ].join('\n')

    const cardStats = [
        '*📊 SUAS ESTATÍSTICAS*',
        `▸  *Posição (Dados):* #${stats.posicaoMB} (${stats.totalFormatado})`,
        `▸  *Posição (Saldo):* #${stats.posicaoSaldo} (${stats.totalSaldo} MT)`,
        `▸  *Total de Compras:* ${stats.compras} pedido(s) (${stats.comprasHoje} hoje)`,
        '──────────────────'
    ].join('\n')

    const cardLideres = [
        '*👑 DESTAQUES DO GRUPO*',
        `▸  *Líder em Megas:* ${stats.topGrupoMB}${topNomeMB}`,
        `▸  *Líder em Saldo:* ${stats.topGrupoSaldo}${topNomeSaldo}`,
        '──────────────────'
    ].join('\n')

    const footerInd = [
        '*🌐 RANKING GERAL*',
        `▸  Lista completa: ${prefix}ranking geral`,
        '──────────────────'
    ].join('\n')

    const finalMsgInd = [headerInd, cardStats, cardLideres, footerInd].join('\n\n')
    await sock.sendMessage(from, {
        text: finalMsgInd,
        mentions: [targetJid]
    }, { quoted: msg })

    return true
}
