const verificacao = require('./verificacao')
const comprovantesOficiais = require('./comprovantesOficiais')
const { enfileirarEntregas } = require('../auto/entregaAuto')
const { marcarReciboUsado, finalizarProcessamentoRecibo } = require('./recibos')
const { salvarEntregaPendente } = require('../bot/entregasPendentes')
const { salvarSessao } = require('./sessao')

const emAndamento = new Set()

const MOTIVOS_RECUSA = {
    pagamento_nao_confirmado: 'O pagamento não foi encontrado na conta oficial da operadora dentro do prazo.',
    valor_divergente: 'O valor recebido não corresponde ao valor do comprovativo.',
    codigo_reutilizado: 'Este comprovativo já foi utilizado.',
    codigo_invalido: 'Este código não parece um ID de transação da operadora.',
    sms_desatualizado: 'Este pagamento está fora do prazo de validação (1 hora).',
    sms_sem_valor: 'O SMS oficial não informa o valor recebido.',
    sms_indisponivel: 'O SMS oficial deste pagamento já foi utilizado ou não está disponível.',
    assinatura_invalida: 'O SMS oficial não tem assinatura válida.',
    recusado_pelo_admin: 'Comprovativo recusado pela administração.',
    expirado: 'O comprovativo expirou sem confirmação.'
}

function jidMencao(clienteId) {
    if (!clienteId) return null
    if (String(clienteId).endsWith('@lid')) return String(clienteId)
    return String(clienteId).split('@')[0].split(':')[0] + '@s.whatsapp.net'
}

function numeroVisivel(jid) {
    return String(jid || '').split('@')[0].split(':')[0]
}

function guardarEntregas(pendente, pedidos) {
    for (const item of pedidos) {
        const dadosEntrega = {
            clienteId: pendente.clienteId,
            clienteNome: pendente.clienteNome,
            numero: item.numero,
            pacote: item.displayPacote,
            valor: item.valor,
            codigo: pendente.codigo,
            grupoOrigem: pendente.grupoId,
            timestamp: Date.now()
        }
        salvarEntregaPendente(item.numero, dadosEntrega)
        if (!item.numero.startsWith('258')) salvarEntregaPendente('258' + item.numero, dadosEntrega)
        if (item.numero.startsWith('258')) salvarEntregaPendente(item.numero.substring(3), dadosEntrega)
        if (pendente.clienteId) salvarEntregaPendente(pendente.clienteId, dadosEntrega)
        if (pendente.codigo) salvarEntregaPendente(pendente.codigo, dadosEntrega)
    }
}

async function aprovarPendente(sock, pendente, opts = {}) {
    if (!pendente || !pendente.codigo) return { ok: false }
    if (emAndamento.has(pendente.codigo)) return { ok: false, motivo: 'em_processamento' }
    emAndamento.add(pendente.codigo)

    try {
        verificacao.removerPendente(pendente.codigo)

        const pedidos = Array.isArray(pendente.pedidos) ? pendente.pedidos : []
        const semNumero = pedidos.length === 0
        let autoEntrega = { ok: false, resultados: [], motivo: 'sem-pedidos' }

        if (semNumero && pendente.grupoId && pendente.clienteId) {
            salvarSessao(pendente.clienteId, {
                codigo: pendente.codigo,
                valor: pendente.valor,
                nome: pendente.clienteNome,
                from: pendente.grupoId,
                remetente: pendente.clienteId,
                origem: 'sms',
                sistema: pendente.sistema || '',
                pagamentoConfirmadoSms: true
            })
        }

        if (pedidos.length > 0) {
            guardarEntregas(pendente, pedidos)
            try {
                autoEntrega = await enfileirarEntregas({
                    from: pendente.grupoId,
                    sender: pendente.clienteId,
                    pedidos,
                    codigo: pendente.codigo,
                    nome: pendente.clienteNome,
                    valorTotal: pendente.valor,
                    tipoPacote: pendente.tipoPacote || '',
                    ussdMethod: pendente.ussdMethod || '*162#'
                })
            } catch (err) {
                console.error('[APROVACAO] Falha ao enfileirar comprovativo aprovado:', err.message)
            }
        }

        marcarReciboUsado(pendente.codigo, {
            valor: pendente.valor,
            destino: pendente.destino,
            por: opts.por || 'sms-oficial',
            confirmadoPor: opts.porJid || 'sms-operadora'
        })
        await comprovantesOficiais.marcarUtilizado(pendente.codigo, pendente.centralCode, opts.por || 'sms-oficial')

        if (sock && pendente.msgKey) {
            try {
                await sock.sendMessage(pendente.grupoId, { react: { text: '✅', key: pendente.msgKey } })
            } catch { }
        }

        const pedidosIds = autoEntrega.ok
            ? autoEntrega.resultados.filter(r => r.ok).map(r => r.pedido.id)
            : []
        const dadosTxt = pedidos.map(p => p.displayPacote || `${p.mb}MB`).join(' • ')
        const clienteJid = jidMencao(pendente.clienteId)
        const adminJid = opts.porJid ? jidMencao(opts.porJid) : null
        const termoEspera = autoEntrega.ok
            ? 'Pedido enviado ao servidor automaticamente. Acompanha o estado por aqui!'
            : semNumero
                ? 'Pagamento validado. Envia o teu número Vodacom para receber os megas.'
                : 'Pagamento validado. A entrega será feita pela administração.'

        const linhas = [
            '✅ *PAGAMENTO CONFIRMADO*',
            '────────────────────────',
            `👤 *Cliente:* @${numeroVisivel(pendente.clienteId)}`,
            `💵 *Valor:* ${pendente.valor} MT`,
            ...(dadosTxt ? [`📊 *Dados:* ${dadosTxt}`] : []),
            `📋 *Recibo:* \`${pendente.codigo}\``,
            `🔎 *Fonte:* ${opts.origemLabel || 'SMS oficial da operadora'}`,
            ...(adminJid ? [`👑 *Confirmado por:* @${numeroVisivel(adminJid)}`] : []),
            ...(pedidosIds.length > 0 ? [`🧾 *Pedido:* ${pedidosIds.join(', ')}`] : []),
            ...(semNumero
                ? [
                    '────────────────────────',
                    '📱 *Envie agora o teu número Vodacom para receber os megas:*',
                    '_Exemplo: 841234567_'
                ]
                : []),
            '────────────────────────',
            `⏳ _${termoEspera}_`
        ]

        if (sock && pendente.grupoId) {
            const mencoes = [clienteJid, adminJid].filter(Boolean)
            try {
                await sock.sendMessage(pendente.grupoId, { text: linhas.join('\n'), mentions: mencoes })
            } catch {
                try { await sock.sendMessage(pendente.grupoId, { text: linhas.join('\n') }) } catch { }
            }
        }

        return { ok: true, autoEntrega, pedidosIds }
    } finally {
        emAndamento.delete(pendente.codigo)
    }
}

async function recusarPendente(sock, pendente, opts = {}) {
    if (!pendente || !pendente.codigo) return { ok: false }
    if (emAndamento.has(pendente.codigo)) return { ok: false, motivo: 'em_processamento' }
    emAndamento.add(pendente.codigo)

    try {
        verificacao.removerPendente(pendente.codigo)

        marcarReciboUsado(pendente.codigo, {
            valor: pendente.valor,
            destino: pendente.destino,
            por: 'recusado',
            recusadoPor: opts.porJid || 'verificacao-sms'
        })
        finalizarProcessamentoRecibo(pendente.codigo)

        if (sock && pendente.msgKey) {
            try {
                await sock.sendMessage(pendente.grupoId, { react: { text: '❌', key: pendente.msgKey } })
            } catch { }
        }

        const motivo = MOTIVOS_RECUSA[opts.motivo] || MOTIVOS_RECUSA.pagamento_nao_confirmado
        const clienteJid = jidMencao(pendente.clienteId)
        const adminJid = opts.porJid ? jidMencao(opts.porJid) : null

        const linhas = [
            '❌ *COMPROVATIVO NÃO CONFIRMADO*',
            '────────────────────────',
            `👤 *Cliente:* @${numeroVisivel(pendente.clienteId)}`,
            `💵 *Valor:* ${pendente.valor} MT`,
            `📋 *Recibo:* \`${pendente.codigo}\``,
            ...(adminJid ? [`👑 *Recusado por:* @${numeroVisivel(adminJid)}`] : []),
            '────────────────────────',
            `🔎 ${motivo}`,
            '',
            'Nenhum dado foi enviado. Se o pagamento foi feito, fale com a administração.'
        ]

        if (sock && pendente.grupoId) {
            const mencoes = [clienteJid, adminJid].filter(Boolean)
            try {
                await sock.sendMessage(pendente.grupoId, { text: linhas.join('\n'), mentions: mencoes })
            } catch {
                try { await sock.sendMessage(pendente.grupoId, { text: linhas.join('\n') }) } catch { }
            }
        }

        return { ok: true }
    } finally {
        emAndamento.delete(pendente.codigo)
    }
}

module.exports = {
    MOTIVOS_RECUSA,
    aprovarPendente,
    recusarPendente
}
