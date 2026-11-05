const config = require('../../data/config.json')
const { formatarVolumeCurto } = require('../utils/volume')

const SEPARADOR = '────────────────────────'

function numeroVisivel(jid) {
    return String(jid || '').split('@')[0].split(':')[0]
}

function jidMencao(clienteId) {
    if (!clienteId) return null
    if (String(clienteId).endsWith('@lid')) return String(clienteId)
    return String(clienteId).split('@')[0].split(':')[0] + '@s.whatsapp.net'
}

function formatarDataHora(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date)
    const partes = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Maputo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(d)
    const valor = tipo => partes.find(p => p.type === tipo)?.value || ''
    return `${valor('day')}-${valor('month')}-${valor('year')} às ${valor('hour')}:${valor('minute')}`
}

function formatarListaItens(itens) {
    return (Array.isArray(itens) ? itens : [])
        .map(item => `📦 ${Math.round(item.mbTotal || item.mb || 0)}MB ➔ ${item.numero}`)
        .join('\n')
}

function formatarPagamentoConfirmado(compra) {
    return [
        '✅ *PAGAMENTO CONFIRMADO*',
        '',
        '*A ENVIAR:*',
        formatarListaItens(compra.itens),
        '',
        `🧾 *PEDIDO:* #${compra.pedidoNumero}`,
        `🕒 *DATA:* ${formatarDataHora(new Date(compra.criadoEm || Date.now()))}`,
        '',
        '_Processamento automático._'
    ].join('\n')
}

function formatarAguardando(compra, motivo) {
    return [
        '⏳ *PAGAMENTO CONFIRMADO*',
        '',
        '*A ENVIAR:*',
        formatarListaItens(compra.itens),
        '',
        `🧾 *PEDIDO:* #${compra.pedidoNumero}`,
        '',
        `_${motivo || 'Aguardando capacidade nos chips. O pedido será processado automaticamente.'}_`
    ].join('\n')
}

function formatarParteEnviada(compra, parte) {
    const total = Number(compra.totalPartes) || 1
    const enviadas = Number(compra.partesEnviadas) || 0
    const faltam = Math.max(0, total - enviadas)
    const titulo = enviadas <= 1
        ? `✅ *1/${total} parte enviada*`
        : `✅ *${enviadas}/${total} partes enviadas*`

    return [
        titulo,
        '',
        `📦 ${Math.round(parte.mb)}MB ➔ ${parte.numero}`,
        `🧾 *PEDIDO:* #${compra.pedidoNumero}`,
        ...(faltam > 0 ? [`📤 *Faltam ${faltam} partes*`] : []),
        '',
        '_Processamento automático._'
    ].join('\n')
}

function formatarTransferenciaCompleta(compra) {
    const linhas = (compra.itens || []).map(item => {
        const partesDoItem = (compra.partes || []).filter(p => p.numero === item.numero)
        const total = partesDoItem.length || 1
        return `📦 ${total}/${total} partes enviadas ➔ ${item.numero}`
    })

    return [
        '🎉 *TRANSFERÊNCIA COMPLETA*',
        '',
        ...(linhas.length > 0 ? linhas : [`📦 ${compra.totalPartes}/${compra.totalPartes} partes enviadas`]),
        '',
        `🧾 *PEDIDO:* #${compra.pedidoNumero}`,
        `🕒 *HORA:* ${formatarDataHora()}`
    ].join('\n')
}

function formatarCompraConcluida(compra, stats) {
    const botName = String(config.botName || 'BOT').toUpperCase()
    const hoje = formatarVolumeCurto(stats?.hoje?.mb || 0, true)
    const semana = formatarVolumeCurto(stats?.semana?.mb || 0, true)
    const mes = formatarVolumeCurto(stats?.mes?.mb || 0, true)
    const total = formatarVolumeCurto(stats?.total?.mb || compra.totalMb || 0, true)

    return [
        '✅ *COMPRA CONCLUÍDA COM SUCESSO!*',
        '',
        `👤 *Cliente:* @${numeroVisivel(compra.clienteId)}`,
        `📦 *Compra:* ${formatarVolumeCurto(compra.totalMb, true)}`,
        '⚡ *Estado:* ENTREGUE ✅',
        '',
        SEPARADOR,
        '',
        '📊 *RESUMO DAS TUAS COMPRAS*',
        '',
        `📅 Hoje: ${hoje}`,
        `📆 Semana: ${semana}`,
        `🗓️ Mês: ${mes}`,
        `🏆 Total acumulado: ${total}`,
        '',
        '🥇 Obrigado pela confiança e preferência!',
        '📈 Boas vendas, bons lucros e excelentes negócios!',
        '',
        SEPARADOR,
        '',
        `🤖 ${botName}`
    ].join('\n')
}

function formatarFalha(compra, parte, motivo) {
    return [
        '⚠️ *FALHA NO ENVIO*',
        '',
        `📦 ${Math.round(parte.mb)}MB ➔ ${parte.numero}`,
        `🧾 *PEDIDO:* #${compra.pedidoNumero}`,
        `🔎 _${motivo || 'Não foi possível concluir o envio.'}_`,
        '',
        'A administração foi avisada.'
    ].join('\n')
}

function formatarCompraParcial(compra) {
    const falhas = (compra.partes || []).filter(p => p.status === 'FALHA')
    return [
        '⚠️ *COMPRA PARCIALMENTE CONCLUÍDA*',
        '',
        `📦 *Compra:* ${formatarVolumeCurto(compra.totalMb, true)}`,
        `✅ *Partes entregues:* ${compra.partesEnviadas}/${compra.totalPartes}`,
        `❌ *Partes falhadas:* ${falhas.length}`,
        ...(falhas.length > 0 ? ['', ...falhas.map(p => `• ${p.mb}MB ➔ ${p.numero}`)] : []),
        '',
        `🧾 *PEDIDO:* #${compra.pedidoNumero}`,
        '',
        '_A administração fará o reenvio das partes em falta._'
    ].join('\n')
}

async function enviarTexto(sock, grupoId, texto, mencoes = []) {
    if (!sock || !grupoId || !texto) return false
    try {
        await sock.sendMessage(grupoId, { text: texto, ...(mencoes.length ? { mentions: mencoes } : {}) })
        return true
    } catch {
        try {
            await sock.sendMessage(grupoId, { text: texto })
            return true
        } catch {
            return false
        }
    }
}

async function enviarPagamentoConfirmado(sock, compra) {
    return enviarTexto(sock, compra.grupoId, formatarPagamentoConfirmado(compra))
}

async function enviarAguardando(sock, compra, motivo) {
    return enviarTexto(sock, compra.grupoId, formatarAguardando(compra, motivo))
}

async function enviarParte(sock, compra, parte) {
    return enviarTexto(sock, compra.grupoId, formatarParteEnviada(compra, parte))
}

async function enviarTransferenciaCompleta(sock, compra) {
    return enviarTexto(sock, compra.grupoId, formatarTransferenciaCompleta(compra))
}

async function enviarCompraConcluida(sock, compra, stats) {
    const jid = jidMencao(compra.clienteId)
    return enviarTexto(sock, compra.grupoId, formatarCompraConcluida(compra, stats), jid ? [jid] : [])
}

async function enviarFalha(sock, compra, parte, motivo) {
    return enviarTexto(sock, compra.grupoId, formatarFalha(compra, parte, motivo))
}

async function enviarCompraParcial(sock, compra) {
    return enviarTexto(sock, compra.grupoId, formatarCompraParcial(compra))
}

module.exports = {
    formatarDataHora,
    formatarPagamentoConfirmado,
    formatarAguardando,
    formatarParteEnviada,
    formatarTransferenciaCompleta,
    formatarCompraConcluida,
    formatarFalha,
    formatarCompraParcial,
    enviarPagamentoConfirmado,
    enviarAguardando,
    enviarParte,
    enviarTransferenciaCompleta,
    enviarCompraConcluida,
    enviarFalha,
    enviarCompraParcial,
    jidMencao,
    numeroVisivel
}
