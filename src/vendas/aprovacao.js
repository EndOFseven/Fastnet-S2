const verificacao = require('./verificacao')
const comprovantesOficiais = require('./comprovantesOficiais')
const fluxoCompra = require('../auto/fluxoCompra')
const { obterVinculo } = require('../auto/vinculo')
const { marcarReciboUsado, finalizarProcessamentoRecibo } = require('./recibos')
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

async function aprovarPendente(sock, pendente, opts = {}) {
    if (!pendente || !pendente.codigo) return { ok: false }
    if (emAndamento.has(pendente.codigo)) return { ok: false, motivo: 'em_processamento' }
    emAndamento.add(pendente.codigo)

    try {
        verificacao.removerPendente(pendente.codigo)

        const pedidos = Array.isArray(pendente.pedidos) ? pendente.pedidos : []
        const semNumero = pedidos.length === 0
        let compraResultado = null

        if (semNumero && pendente.grupoId && pendente.clienteId) {
            salvarSessao(pendente.clienteId, {
                codigo: pendente.codigo,
                valor: pendente.valor,
                nome: pendente.clienteNome,
                from: pendente.grupoId,
                remetente: pendente.clienteId,
                origem: 'sms',
                sistema: pendente.sistema || '',
                tipoPacote: pendente.tipoPacote || '',
                ussdMethod: pendente.ussdMethod || '*162#',
                centralCode: pendente.centralCode || obterVinculo(pendente.grupoId).centralCode || '',
                pagamentoConfirmadoSms: true
            })
        }

        if (!semNumero) {
            const vinculo = pendente.centralCode ? null : obterVinculo(pendente.grupoId)
            const centralCode = pendente.centralCode || vinculo?.centralCode || ''
            try {
                compraResultado = await fluxoCompra.criarCompra({
                    sock,
                    from: pendente.grupoId,
                    sender: pendente.clienteId,
                    nome: pendente.clienteNome,
                    itens: pedidos,
                    valorTotal: pendente.valor,
                    tipoPacote: pendente.tipoPacote || '',
                    codigo: pendente.codigo,
                    ussdMethod: pendente.ussdMethod || '*162#',
                    centralCode,
                    origem: opts.por || 'sms-oficial',
                    msgPagamentoKey: pendente.cardKey || null
                })
            } catch (err) {
                console.error('[APROVACAO] Falha ao criar compra automática:', err.message)
                compraResultado = { ok: false, motivo: 'erro-interno', erro: 'Falha ao iniciar o envio automático.' }
            }
        }

        const compraOk = Boolean(compraResultado?.ok)
        const compraAguardando = Boolean(compraResultado?.aguardando)
        const vendaJaRegistrada = Boolean(compraResultado?.compra?.vendaRegistrada)

        if (!compraOk && !vendaJaRegistrada) {
            marcarReciboUsado(pendente.codigo, {
                valor: pendente.valor,
                destino: pendente.destino,
                por: opts.por || 'sms-oficial',
                confirmadoPor: opts.porJid || 'sms-operadora'
            })
            finalizarProcessamentoRecibo(pendente.codigo)
        }
        await comprovantesOficiais.marcarUtilizado(pendente.codigo, pendente.centralCode, opts.por || 'sms-oficial')

        if (sock && pendente.msgKey) {
            try {
                await sock.sendMessage(pendente.grupoId, { react: { text: '✅', key: pendente.msgKey } })
            } catch { }
        }

        if (sock && pendente.grupoId && (semNumero || (!compraOk && !compraAguardando))) {
            const clienteJid = jidMencao(pendente.clienteId)
            const adminJid = opts.porJid ? jidMencao(opts.porJid) : null
            const dadosTxt = pedidos.map(p => p.displayPacote || `${p.mb}MB`).join(' • ')
            const erro = compraResultado?.erro || compraResultado?.motivo || ''
            const linhas = semNumero
                ? [
                    '✅ *PAGAMENTO CONFIRMADO*',
                    '────────────────────────',
                    `👤 *Cliente:* @${numeroVisivel(pendente.clienteId)}`,
                    `💵 *Valor:* ${pendente.valor} MT`,
                    ...(dadosTxt ? [`📊 *Dados:* ${dadosTxt}`] : []),
                    `📋 *Recibo:* \`${pendente.codigo}\``,
                    `🔎 *Fonte:* ${opts.origemLabel || 'SMS oficial da operadora'}`,
                    ...(adminJid ? [`👑 *Confirmado por:* @${numeroVisivel(adminJid)}`] : []),
                    '────────────────────────',
                    '📱 *Envie agora o teu número Vodacom para receber os megas:*',
                    '_Exemplo: 841234567_',
                    '────────────────────────',
                    '⏳ _Pagamento validado. Envia o teu número para receber os megas._'
                ]
                : [
                    '⚠️ *PAGAMENTO CONFIRMADO, MAS FALHOU O ENVIO AUTOMÁTICO*',
                    '────────────────────────',
                    `👤 *Cliente:* @${numeroVisivel(pendente.clienteId)}`,
                    `💵 *Valor:* ${pendente.valor} MT`,
                    ...(dadosTxt ? [`📊 *Dados:* ${dadosTxt}`] : []),
                    `📋 *Recibo:* \`${pendente.codigo}\``,
                    ...(erro ? [`🔎 *Motivo:* ${erro}`] : []),
                    '────────────────────────',
                    'A administração foi avisada. Nenhum dado foi perdido.'
                ]

            const mencoes = [clienteJid, adminJid].filter(Boolean)
            try {
                await sock.sendMessage(pendente.grupoId, { text: linhas.join('\n'), mentions: mencoes })
            } catch {
                try { await sock.sendMessage(pendente.grupoId, { text: linhas.join('\n') }) } catch { }
            }
        }

        return {
            ok: compraOk || semNumero || compraAguardando,
            compra: compraResultado?.compra || null,
            aguardando: compraAguardando,
            motivo: compraResultado?.motivo
        }
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
