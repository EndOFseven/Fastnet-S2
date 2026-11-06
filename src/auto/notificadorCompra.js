const config = require('../../data/config.json')
const { formatarVolumeCurto } = require('../utils/volume')

const SEPARADOR = '────────────────────────'
const LIMIAR_TRANSFERENCIA_MB = 20 * 1024
const LIMIAR_RESUMO_MB = 10 * 1024

function ehPacoteDados(compra) {
    if (!compra) return false
    if (compra.isSaldo === true) return false
    return !/saldo/i.test(String(compra.tipoPacote || ''))
}

function limitesMensagensFinais(compra) {
    if (!ehPacoteDados(compra)) {
        return { transferenciaCompleta: true, resumo: true }
    }

    const totalMb = Number(compra?.totalMb) || 0
    return {
        transferenciaCompleta: totalMb >= LIMIAR_TRANSFERENCIA_MB,
        resumo: totalMb >= LIMIAR_RESUMO_MB
    }
}

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

function formatarMeticais(valor) {
    return new Intl.NumberFormat('pt-MZ', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(Number(valor) || 0)
}

function formatarTelefone(numero) {
    const digitos = String(numero || '').replace(/\D/g, '')
    if (digitos.length === 9) return `+258 ${digitos.slice(0, 2)} ${digitos.slice(2, 5)} ${digitos.slice(5)}`
    if (digitos.length === 12 && digitos.startsWith('258')) return `+${digitos}`
    return digitos || 'Nao informado'
}

function formatarBlocoPagamento(compra) {
    const p = compra?.pagamento
    if (!p || typeof p !== 'object') return []
    const linhas = ['', '*PAGAMENTO:*']
    if (p.sistema) linhas.push(`Operadora: ${p.sistema}`)
    linhas.push(`Valor: ${formatarMeticais(p.valor)} MT`)
    if (p.pagadorNome) linhas.push(`Pagador: ${p.pagadorNome}`)
    if (p.pagadorTelefone) linhas.push(`Telefone: ${formatarTelefone(p.pagadorTelefone)}`)
    if (p.targetPhone) linhas.push(`Destino: ${formatarTelefone(p.targetPhone)}`)
    if (p.txId) linhas.push(`Transacao: ${p.txId}`)
    if (p.recebidoEm) linhas.push(`Recebido: ${formatarDataHora(new Date(p.recebidoEm))}`)
    return linhas
}

const MOTIVOS_ALERTA_PAGAMENTO = {
    sem_conteudo: 'SMS sem o campo Conteudo com o numero Vodacom.',
    conteudo_invalido: 'O campo Conteudo nao contem um numero Vodacom valido.',
    conteudo_multiplo: 'O campo Conteudo contem mais de um numero Vodacom.',
    destino_ausente: 'O numero de destino assinado esta ausente ou invalido.',
    destino_divergente: 'O numero do Conteudo nao corresponde ao destino assinado.',
    saldo: 'O valor corresponde a saldo; o modo automatico entrega apenas dados.',
    sem_pacote: 'Nao ha pacote de dados configurado para este valor.',
    ambiguo: 'Ha mais de um pacote de dados possivel para este valor.',
    valor_invalido: 'O valor do comprovativo e invalido.',
    app_antigo: 'Comprovativo gravado por app antigo. Actualize o app para 2.3.28 ou superior.',
    assinatura_invalida: 'Assinatura v2 invalida. O comprovativo nao sera usado.',
    central_divergente: 'O comprovativo foi assinado para outro servidor.',
    usado: 'Comprovativo ja utilizado.',
    erro_compra: 'Falha ao criar a compra automatica.',
    sem_transacao: 'Comprovativo sem identificador de transacao.'
}

function formatarAlertaPagamentoAuto({ motivo, oficial, conteudo, pacotes, pagador } = {}) {
    const prefix = config.prefix || '.'
    const dados = oficial || {}
    const linhas = [
        '*ALERTA - PAGAMENTO AUTOMATICO*',
        '',
        `Motivo: ${MOTIVOS_ALERTA_PAGAMENTO[motivo] || motivo || 'Erro desconhecido.'}`,
        '',
        `Transacao: ${dados.tx_id || 'Nao informada'}`,
        `Operadora: ${dados.provider || 'Nao informada'}`,
        `Valor: ${formatarMeticais(dados.amount_mt)} MT`,
        `Pagador: ${pagador?.nome || dados.name || 'Nao identificado'}`,
        `Telefone: ${formatarTelefone(pagador?.telefone || dados.phone)}`,
        `Recebido: ${dados.timestamp ? formatarDataHora(new Date(Number(dados.timestamp))) : 'Nao informado'}`
    ]

    if (conteudo?.numeros?.length) linhas.push(`Conteudo: ${conteudo.numeros.join(', ')}`)
    else if (conteudo?.numero) linhas.push(`Conteudo: ${conteudo.numero}`)
    if (dados.target_phone) linhas.push(`Destino assinado: ${dados.target_phone}`)

    if (Array.isArray(pacotes) && pacotes.length > 0) {
        linhas.push('', '*PACOTES ENCONTRADOS:*')
        for (const pacote of pacotes) linhas.push(`- ${pacote.gb || pacote.mb}MB (${formatarMeticais(pacote.preco)} MT)`)
    }

    linhas.push('', `_Resolva com \`${prefix}enviarauto <telefone> <mb>\`._`)
    return linhas.join('\n')
}

function formatarPagamentoConfirmado(compra) {
    return [
        '✅ *PAGAMENTO CONFIRMADO*',
        '',
        '*A ENVIAR:*',
        formatarListaItens(compra.itens),
        ...formatarBlocoPagamento(compra),
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
        ...formatarBlocoPagamento(compra),
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

async function enviarTexto(sock, grupoId, texto, mencoes = [], opcoes = {}) {
    if (!sock || !grupoId || !texto) return false
    const editKey = opcoes.editKey
    if (editKey && editKey.id) {
        try {
            await sock.sendMessage(grupoId, {
                text: texto,
                ...(mencoes.length ? { mentions: mencoes } : {}),
                edit: {
                    id: editKey.id,
                    remoteJid: editKey.remoteJid || grupoId,
                    fromMe: editKey.fromMe !== false
                }
            })
            return true
        } catch {}
    }
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

async function enviarPagamentoConfirmado(sock, compra, opcoes = {}) {
    return enviarTexto(sock, compra.grupoId, formatarPagamentoConfirmado(compra), [], opcoes)
}

async function enviarAlertaPagamentoAuto(sock, grupoId, dados) {
    return enviarTexto(sock, grupoId, formatarAlertaPagamentoAuto(dados))
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
    LIMIAR_TRANSFERENCIA_MB,
    LIMIAR_RESUMO_MB,
    ehPacoteDados,
    limitesMensagensFinais,
    formatarDataHora,
    formatarMeticais,
    formatarTelefone,
    formatarBlocoPagamento,
    formatarAlertaPagamentoAuto,
    formatarPagamentoConfirmado,
    formatarAguardando,
    formatarParteEnviada,
    formatarTransferenciaCompleta,
    formatarCompraConcluida,
    formatarFalha,
    formatarCompraParcial,
    enviarPagamentoConfirmado,
    enviarAlertaPagamentoAuto,
    enviarAguardando,
    enviarParte,
    enviarTransferenciaCompleta,
    enviarCompraConcluida,
    enviarFalha,
    enviarCompraParcial,
    jidMencao,
    numeroVisivel
}
