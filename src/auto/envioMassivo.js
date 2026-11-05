const fs = require('fs')
const path = require('path')
const fila = require('./fila')
const tabela = require('../vendas/tabela')
const { obterCapacidadeSims, distribuirPartes } = require('./simSelector')
const { planejarPartes } = require('./planejadorPartes')
const { formatarVolumeCurto } = require('../utils/volume')
const { limparLinha, extrairNumero, extrairPacote, parsearLista } = require('./envioMassivoParser')
const { comLock } = require('./enfileiramentoLock')

const ARQUIVO = path.join(__dirname, '../../data/enviosMassivos.json')
const MAX_PARTES_LOTE = 20
const TIMEOUT_PENDENTE_MS = 60 * 60 * 1000
const STATUS_ATIVOS = ['ENFILEIRANDO', 'EM_ANDAMENTO']
const STATUS_FINAIS = ['CONCLUIDO', 'FALHA_PARCIAL', 'ERRO']

function carregarEstado() {
    try {
        const bruto = fs.readFileSync(ARQUIVO, 'utf8')
        const dados = JSON.parse(bruto)
        if (dados && typeof dados === 'object' && dados.lotes && typeof dados.lotes === 'object') return dados
    } catch {}
    return { lotes: {} }
}

function salvarEstado(estado) {
    try {
        fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
        const tmp = ARQUIVO + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(estado, null, 2))
        fs.renameSync(tmp, ARQUIVO)
        return true
    } catch (err) {
        console.error('[MASSIVO] Erro ao salvar estado:', err.message)
        return false
    }
}

function listarLotes() {
    return Object.values(carregarEstado().lotes)
}

function buscarLote(id) {
    if (!id) return null
    return carregarEstado().lotes[id] || null
}

function salvarLote(lote) {
    const estado = carregarEstado()
    estado.lotes[lote.id] = lote
    salvarEstado(estado)
    return lote
}

function loteAtivoDoGrupo(grupoId) {
    return listarLotes().find(l => l.grupoId === grupoId && STATUS_ATIVOS.includes(l.status)) || null
}

function resolverPacote(pacote, grupoId) {
    const texto = tabela.obterTabelaMegasGrupo(grupoId)
    if (!texto) return { ok: false, erro: 'A tabela de megas deste grupo não está configurada.' }

    const dados = tabela.buscarDadosPorPacoteNaTabela(pacote, texto)
    if (!dados) return { ok: false, erro: `Pacote "${pacote}" não encontrado na tabela.` }
    if (dados.preco === null || dados.preco === undefined) {
        return { ok: false, erro: `O pacote "${pacote}" não tem preço na tabela.` }
    }

    const mb = Math.round(Number(dados.mb) || 0)
    if (mb <= 0) return { ok: false, erro: `Pacote "${pacote}" inválido.` }
    if (mb < 100) return { ok: false, erro: `O pacote mínimo é 100MB.` }

    return {
        ok: true,
        mb,
        preco: Number(dados.preco) || 0,
        tipo: dados.tipo || 'Convencional',
        display: dados.gb || formatarVolumeCurto(mb),
        extraDesc: dados.extraDesc || ''
    }
}

function validarItens(itens, grupoId) {
    const resolvidos = []
    const numeros = new Set()
    let totalPartes = 0

    for (const item of itens) {
        const resolvido = resolverPacote(item.pacote, grupoId)
        if (!resolvido.ok) return { ok: false, erro: resolvido.erro }

        if (numeros.has(item.numero)) {
            return { ok: false, erro: `Número repetido: ${item.numero}.` }
        }
        numeros.add(item.numero)

        const partes = planejarPartes(resolvido.mb)
        if (partes.length === 0) return { ok: false, erro: `Pacote inválido para ${item.numero}.` }
        totalPartes += partes.length
        if (totalPartes > MAX_PARTES_LOTE) {
            return { ok: false, erro: `O lote excede o limite de ${MAX_PARTES_LOTE} partes.` }
        }

        resolvidos.push({
            numero: item.numero,
            pacote: item.pacote,
            mb: resolvido.mb,
            preco: resolvido.preco,
            tipo: resolvido.tipo,
            display: resolvido.display,
            partes: partes.map((mbParte, indice) => ({
                numero: item.numero,
                mb: mbParte,
                mbEnvio: mbParte,
                indiceItem: indice + 1,
                totalItem: partes.length
            }))
        })
    }

    return { ok: true, itens: resolvidos, totalPartes }
}

function montarPartesDoLote(itens) {
    const partes = []
    for (const item of itens) {
        for (const parte of item.partes) {
            partes.push({
                ...parte,
                id: `MASS-${parte.numero}-${partes.length + 1}-${Date.now()}`,
                parteGlobal: partes.length + 1,
                status: 'PENDENTE',
                pedidoId: null
            })
        }
    }
    return partes
}

function formatarAck(lote) {
    const linhas = lote.itens.map(item => {
        const totalPartes = item.partes.length
        const sufixo = totalPartes > 1 ? ` (${totalPartes}x${Math.round(item.mb / totalPartes)}MB)` : ''
        return `✅ ${item.numero} — ${item.display}${sufixo}`
    })
    return [
        `📡 *Envio massivo — ${lote.totalPartes}/${lote.totalPartes} a caminho.*`,
        '',
        ...linhas
    ].join('\n')
}

function formatarParteEnviada(parte) {
    const sufixo = parte.totalItem > 1 ? ` (${parte.indiceItem}/${parte.totalItem})` : ''
    return `✅ Enviado ${Math.round(parte.mb)}MB para ${parte.numero}.${sufixo}`
}

function formatarParteFalhada(parte) {
    return `❌ Falha ao enviar ${Math.round(parte.mb)}MB para ${parte.numero}.`
}

function formatarFinal(lote) {
    const total = lote.partes.length
    const sucessos = lote.partes.filter(p => p.status === 'SUCESSO')
    const falhas = lote.partes.filter(p => p.status === 'FALHA')
    const volume = formatarVolumeCurto(sucessos.reduce((soma, p) => soma + p.mb, 0), true).replace('GB', ' GB')
    const cabecalho = falhas.length === 0
        ? `🏁 *Envio massivo concluído — ${sucessos.length}/${total} entregues (${volume}).*`
        : `⚠️ *Envio massivo concluído — ${sucessos.length}/${total} entregues; ${falhas.length} falharam (${volume}).*`

    return [
        cabecalho,
        ...(falhas.length > 0
            ? ['', ...falhas.map(p => `• ${Math.round(p.mb)}MB ➔ ${p.numero}`)]
            : [])
    ].join('\n')
}

async function enviarTexto(sock, grupoId, texto) {
    if (!sock || !grupoId || !texto) return false
    try {
        await sock.sendMessage(grupoId, { text: texto })
        return true
    } catch {
        return false
    }
}

async function iniciarLoteInterno({ sock, from, sender, texto, centralCode }) {
    if (!from || !sender) return { ok: false, motivo: 'sem-cliente', erro: 'Remetente não identificado.' }
    if (!centralCode) return { ok: false, motivo: 'sem-servidor', erro: 'Grupo sem servidor vinculado.' }

    const ativo = loteAtivoDoGrupo(from)
    if (ativo) {
        return { ok: false, motivo: 'lote-ativo', erro: `Já existe um envio massivo em andamento (#${ativo.id}).` }
    }

    const lista = parsearLista(texto)
    if (!lista.ok) {
        return {
            ok: false,
            motivo: 'lista-invalida',
            erro: lista.erros.length > 0 ? lista.erros.join('\n') : 'Nenhuma linha válida foi encontrada.'
        }
    }

    const validado = validarItens(lista.itens, from)
    if (!validado.ok) return { ok: false, motivo: 'itens-invalidos', erro: validado.erro }

    const id = `LOTE-${Date.now()}`
    for (const item of validado.itens) {
        item.pedidoNumero = await fila.obterProximoNumeroPedido(centralCode)
    }

    const lote = {
        id,
        grupoId: from,
        solicitadoPor: sender,
        centralCode: String(centralCode).trim().toUpperCase(),
        itens: validado.itens,
        partes: [],
        totalPartes: validado.totalPartes,
        status: 'NOVA',
        criadoEm: Date.now(),
        atualizadoEm: Date.now()
    }

    const capacidade = await obterCapacidadeSims(lote.centralCode)
    if (!capacidade.ok) {
        return { ok: false, motivo: 'sem-capacidade', erro: capacidade.erro }
    }

    const partes = montarPartesDoLote(lote.itens)
    const distribuicao = distribuirPartes(partes.map(p => p.mb), capacidade)
    if (!distribuicao.ok) {
        return { ok: false, motivo: distribuicao.motivo, erro: distribuicao.erro }
    }

    partes.forEach((parte, indice) => {
        const atribuicao = distribuicao.atribuicoes[indice]
        parte.dispositivoId = atribuicao.dispositivoId || null
        parte.slot = atribuicao.slot
        parte.simNome = atribuicao.simNome
        parte.mbEnvio = atribuicao.mbEnvio
        parte.ajuste10 = atribuicao.ajuste10
        parte.id = `MASS-${id.replace(/^LOTE-/, '')}-${indice + 1}`
    })

    lote.partes = partes
    lote.status = 'ENFILEIRANDO'
    salvarLote(lote)

    return enfileirarPartesDoLote(sock, lote)
}

async function enfileirarPartesDoLote(sock, lote) {
    for (const parte of lote.partes) {
        if (parte.pedidoId) continue
        const item = lote.itens.find(i => i.numero === parte.numero)
        const resultado = await fila.enfileirar({
            id: parte.id,
            numeroPedido: item?.pedidoNumero,
            centralCode: lote.centralCode,
            clientePhone: parte.numero,
            megasAmount: parte.mbEnvio,
            mbExibicao: parte.mb,
            valorPago: 0,
            tipoPacote: item?.tipo || '',
            pacoteBaseMb: parte.mb,
            displayPacote: parte.mb >= 1024 ? `${parte.mb / 1024}GB` : `${parte.mb}MB`,
            ussdMethod: '*162#',
            grupoId: lote.grupoId,
            solicitadoPor: lote.solicitadoPor,
            clienteNome: 'Envio massivo',
            bonusMb: 0,
            targetDeviceId: parte.dispositivoId || '',
            targetSimSlot: parte.slot,
            loteId: lote.id,
            parte: parte.parteGlobal,
            totalPartes: lote.totalPartes,
            silenciarCard: true,
            perfil: 'MASSIVO',
            registrarNoMonitor: false,
            timeoutPendenteMs: TIMEOUT_PENDENTE_MS
        })

        if (!resultado.ok) {
            lote.ultimoErro = resultado.motivo
            lote.atualizadoEm = Date.now()
            salvarLote(lote)
            return { ok: false, motivo: resultado.motivo, erro: resultado.motivo }
        }

        parte.pedidoId = resultado.pedido.id
        salvarLote(lote)
    }

    lote.status = 'EM_ANDAMENTO'
    lote.ultimoErro = ''
    lote.atualizadoEm = Date.now()
    salvarLote(lote)
    await enviarTexto(sock, lote.grupoId, formatarAck(lote))

    return { ok: true, lote }
}

async function retomarLotesPendentes(sock) {
    const estado = carregarEstado()
    for (const lote of Object.values(estado.lotes)) {
        if (!lote || lote.status !== 'ENFILEIRANDO') continue
        await comLock(() => enfileirarPartesDoLote(sock, lote))
    }
}

function atualizarParteReatribuida(pedidoId, dados) {
    const pedido = fila.buscarPorId(pedidoId)
    if (!pedido || !pedido.loteId) return false
    const lote = buscarLote(pedido.loteId)
    if (!lote) return false
    const parte = buscarParte(lote, pedido)
    if (!parte) return false

    if (dados.dispositivoId) parte.dispositivoId = dados.dispositivoId
    if (Number.isInteger(dados.slot)) parte.slot = dados.slot
    if (dados.simNome) parte.simNome = dados.simNome
    if (Number.isFinite(Number(dados.mbEnvio))) parte.mbEnvio = Number(dados.mbEnvio)
    if (Number.isFinite(Number(dados.ajuste10))) parte.ajuste10 = Number(dados.ajuste10)
    parte.reatribuidoEm = Date.now()
    lote.atualizadoEm = Date.now()
    salvarLote(lote)
    return true
}

function buscarParte(lote, pedido) {
    if (!lote || !Array.isArray(lote.partes)) return null
    return lote.partes.find(p => p.pedidoId && p.pedidoId === pedido?.id) ||
        lote.partes.find(p => String(p.id) === String(pedido?.id)) ||
        null
}

async function finalizarSePossivel(sock, lote) {
    const finais = lote.partes.every(p => ['SUCESSO', 'FALHA', 'CANCELADO', 'EXPIRADO', 'DESAPARECIDO'].includes(p.status))
    if (!finais || lote.finalizado) return
    lote.finalizado = true
    const falhas = lote.partes.some(p => p.status !== 'SUCESSO')
    lote.status = falhas ? 'FALHA_PARCIAL' : 'CONCLUIDO'
    lote.atualizadoEm = Date.now()
    salvarLote(lote)
    await enviarTexto(sock, lote.grupoId, formatarFinal(lote))
}

async function processarStatusPedidoInterno(sock, pedido, status) {
    if (!pedido || !pedido.loteId) return false
    const lote = buscarLote(pedido.loteId)
    if (!lote) return false

    const parte = buscarParte(lote, pedido)
    if (!parte) return false

    const statusFinal = String(status || pedido.status || '').toUpperCase()
    if (['SUCESSO', 'CONCLUIDO'].includes(statusFinal)) {
        if (parte.status !== 'SUCESSO') {
            parte.status = 'SUCESSO'
            parte.concluidoEm = Date.now()
            salvarLote(lote)
            await enviarTexto(sock, lote.grupoId, formatarParteEnviada(parte))
        }
    } else if (['FALHA', 'CANCELADO', 'EXPIRADO', 'DESAPARECIDO'].includes(statusFinal)) {
        if (parte.status !== 'SUCESSO' && parte.status !== 'FALHA') {
            parte.status = 'FALHA'
            parte.erro = statusFinal
            salvarLote(lote)
            await enviarTexto(sock, lote.grupoId, formatarParteFalhada(parte))
        }
    } else {
        return false
    }

    await finalizarSePossivel(sock, lote)
    return true
}

function iniciarLote(opcoes) {
    return comLock(() => iniciarLoteInterno(opcoes))
}

function processarStatusPedido(sock, pedido, status) {
    return comLock(() => processarStatusPedidoInterno(sock, pedido, status))
}

module.exports = {
    MAX_PARTES_LOTE,
    STATUS_ATIVOS,
    STATUS_FINAIS,
    parsearLista,
    extrairNumero,
    extrairPacote,
    resolverPacote,
    validarItens,
    formatarAck,
    formatarParteEnviada,
    formatarParteFalhada,
    formatarFinal,
    iniciarLote,
    retomarLotesPendentes,
    atualizarParteReatribuida,
    processarStatusPedido,
    listarLotes,
    buscarLote,
    loteAtivoDoGrupo
}
