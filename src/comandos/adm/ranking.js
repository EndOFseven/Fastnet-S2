const path = require('path')
const config = require('../../../data/config.json')
const { getRanking, getClienteStats, formatMB } = require('../../vendas/tracker')
const { setRankingAtivo, isRankingAtivo } = require('../../vendas/gruposConfig')
const { isOwnerCheck, isAdmin, getGroupMetadataCached } = require('../../utils/baileys')
const { formatarComandoIncorreto } = require('../../utils/mensagemHelper')
const { formatarVolume, getVezesPrimeiro } = require('../../vendas/primeiroBonus')
const { loadMapeamento } = require(path.join(__dirname, '../../bot/core.js'))

function medalhaPosicao(posicao) {
    if (posicao === 1) return '🥇'
    if (posicao === 2) return '🥈'
    if (posicao === 3) return '🥉'
    return `${posicao}.`
}

function nomeDoCliente(cliente, mapeamento) {
    const numero = cliente.id.split('@')[0].split(':')[0]
    return mapeamento[numero]?.nome || (cliente.nome !== '---' && cliente.nome ? cliente.nome : `@${numero}`)
}

module.exports = async function (sock, msg, from, sender, text) {
    const rawTokens = text.trim().split(/\s+/)
    const rawCmd = rawTokens[0].toLowerCase()
    const prefix = config.prefix

    const isRankingCmd = (
        rawCmd === prefix + 'ranking' ||
        rawCmd === prefix + 'rank' ||
        rawCmd === prefix + 'meuranking' ||
        rawCmd === prefix + 'meurank' ||
        rawCmd === prefix + 'meuposto' ||
        rawCmd === prefix + 'rankme' ||
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
    try { isAdm = await isAdmin(sock, from, sender) } catch { }

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
                '• Cada membro vê sua posição com `.rank me`.',
                '• A lista geral aparece com `.rank`.'
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
                '💡 _Para religar a qualquer momento, um administrador deve usar:_ `.rank on`'
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
                `👥 *Clientes no ranking:* ${rankingList.filter(c => c.totalMB > 0).length}`,
                `💾 *Total em Megas:* ${formatMB(totalMbGrupo)}`,
                `💰 *Total em Saldo:* ${totalSaldoGrupo.toFixed(2)} MT`,
                '────────────────────────',
                `💡 _Atalhos: \`${prefix}rank on\` | \`${prefix}rank off\` | \`${prefix}rank me\`_`
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
        ((rawCmd === prefix + 'rank' || rawCmd === prefix + 'ranking') && (
            !subCmd ||
            subCmd === 'geral' ||
            subCmd === 'top' ||
            subCmd === 'top10' ||
            subCmd === 'top20' ||
            subCmd === 'top50' ||
            subCmd === 'todos' ||
            subCmd === 'lista' ||
            subCmd === 'list'
        ))
    )

    if (isRankingGeral) {
        if (!isRankingAtivo(from) && !isOwner && !isAdm) {
            await sock.sendMessage(from, {
                text: '❌ *Os administradores desativaram o ranking deste grupo.*'
            }, { quoted: msg })
            return true
        }

        const limite = (rawCmd === prefix + 'top20' || subCmd === 'top20')
            ? 20
            : ((rawCmd === prefix + 'top50' || subCmd === 'top50') ? 50 : 10)
        const ranking = getRanking(from, limite).filter(c => c.totalMB > 0)
        if (ranking.length === 0) {
            const avisoSemVendas = [
                '🏆 *RANKING DE CLIENTES • FASTNET*',
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
        let nomeGrupo = 'Grupo'
        try {
            const metadata = await getGroupMetadataCached(sock, from)
            nomeGrupo = metadata?.subject || 'Grupo'
        } catch { }

        const header = [
            '🏆 *RANKING DE CLIENTES • FASTNET*',
            `📌 *${nomeGrupo}*`,
            '──────────────────'
        ].join('\n')

        const cards = []
        for (let i = 0; i < ranking.length; i++) {
            const cliente = ranking[i]
            const posicao = i + 1
            const numero = cliente.id.split('@')[0].split(':')[0]
            const nomeExibicao = nomeDoCliente(cliente, mapeamento)
            const vezesPrimeiro = getVezesPrimeiro(from, cliente.id)

            const card = [
                `*${medalhaPosicao(posicao)} ${posicao}º LUGAR • ${nomeExibicao.toUpperCase()}*`,
                `▸  *Volume:* ${formatarVolume(cliente.totalMB)}`,
                cliente.totalSaldo > 0 ? `▸  *Saldo:* ${cliente.totalSaldo} MT` : null,
                `▸  *Pedidos:* ${cliente.compras} compra(s)`,
                vezesPrimeiro > 0 ? `▸  *1º do dia:* ${vezesPrimeiro}x` : null,
                `▸  *Contato:* @${numero}`,
                '──────────────────'
            ].filter(Boolean).join('\n')

            cards.push(card)
        }

        const footer = [
            '*💡 SUA POSIÇÃO*',
            `▸  Veja a sua digitando: ${prefix}rank me`,
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
            `${prefix}rank on`
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
    const vezesPrimeiro = getVezesPrimeiro(from, targetJid)

    if (!stats || (stats.totalMB === 0 && stats.totalSaldo === 0 && stats.compras === 0)) {
        const msgVazio = [
            '🏆 *MEU RANKING • FASTNET*',
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
        '🏆 *MEU RANKING • FASTNET*',
        `👤 Cliente: @${targetNumber}`,
        '──────────────────'
    ].join('\n')

    const cardStats = [
        '*📊 SUAS ESTATÍSTICAS*',
        `▸  *Posição (Dados):* #${stats.posicaoMB} (${stats.totalFormatado})`,
        `▸  *Posição (Saldo):* #${stats.posicaoSaldo} (${stats.totalSaldo} MT)`,
        `▸  *Total de Compras:* ${stats.compras} pedido(s) (${stats.comprasHoje} hoje)`,
        `▸  *Primeiro do dia:* ${vezesPrimeiro}x`,
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
        `▸  Lista completa: ${prefix}rank`,
        '──────────────────'
    ].join('\n')

    const finalMsgInd = [headerInd, cardStats, cardLideres, footerInd].join('\n\n')
    await sock.sendMessage(from, {
        text: finalMsgInd,
        mentions: [targetJid]
    }, { quoted: msg })

    return true
}
