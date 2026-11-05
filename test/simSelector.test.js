const test = require('node:test')
const assert = require('node:assert/strict')
const { distribuirPartes, montarCapacidade } = require('../src/auto/simSelector')
const { baseMbDoPedido } = require('../src/auto/partePedido')

function capacidade(extras = {}) {
    return {
        ok: true,
        ativosSemSlot: 0,
        sims: [
            { slot: 0, nome: 'SIM 1', total: 10, usado: 0, ativos: 0, restantes: 10, estoqueMb: 204800, bloqueado: false },
            { slot: 1, nome: 'SIM 2', total: 10, usado: 0, ativos: 0, restantes: 10, estoqueMb: 204800, bloqueado: false }
        ],
        ...extras
    }
}

test('20 partes ficam 10 por chip', () => {
    const resultado = distribuirPartes(Array(20).fill(10240), capacidade())
    assert.equal(resultado.ok, true)
    const porSlot = resultado.atribuicoes.reduce((acc, a) => {
        acc[a.slot] = (acc[a.slot] || 0) + 1
        return acc
    }, {})
    assert.deepEqual(porSlot, { 0: 10, 1: 10 })
})

test('10.º envio de cada chip leva +2MB', () => {
    const resultado = distribuirPartes(Array(20).fill(10240), capacidade())
    const decimos = resultado.atribuicoes.filter(a => a.ajuste10 === 2)
    assert.equal(decimos.length, 2)
    assert.ok(decimos.every(a => a.mbEnvio === 10242))
})

test('reserva pedidos antigos sem chip definido', () => {
    const cap = capacidade({ ativosSemSlot: 1 })
    const resultado = distribuirPartes(Array(20).fill(10240), cap)
    assert.equal(resultado.ok, false)
    assert.equal(resultado.motivo, 'sem-capacidade')
})

test('estoque insuficiente bloqueia a compra', () => {
    const cap = capacidade()
    cap.sims[0].estoqueMb = 5120
    cap.sims[1].estoqueMb = 5120
    const resultado = distribuirPartes(Array(2).fill(10240), cap)
    assert.equal(resultado.ok, false)
    assert.ok(['sem-estoque', 'sem-capacidade'].includes(resultado.motivo))
})

function ativosVazios() {
    return {
        porDispositivo: new Map(),
        global: {
            porSlot: { 0: 0, 1: 0 },
            megasPorSlot: { 0: 0, 1: 0 },
            semSlot: 0,
            megasSemSlot: 0
        }
    }
}

function sim(megas = 10240) {
    return { megas, total: 10, usado: 0 }
}

test('30GB distribui uma parte por cada um de três celulares', () => {
    const agora = Date.now()
    const simData = {
        A: { sim1: sim(), heartbeat: agora },
        B: { sim1: sim(), heartbeat: agora },
        C: { sim1: sim(), heartbeat: agora }
    }
    const telemetria = {
        A: { papel: 'DISPARADOR_MEGAS' },
        B: { papel: 'DISPARADOR_MEGAS' },
        C: { papel: 'TUDO_EM_UM' }
    }
    const cap = montarCapacidade(simData, telemetria, ativosVazios(), 'S2-TESTE', { agora })
    const resultado = distribuirPartes([10240, 10240, 10240], cap)
    assert.equal(resultado.ok, true)
    assert.deepEqual(resultado.atribuicoes.map(a => a.dispositivoId).sort(), ['A', 'B', 'C'])
})

test('celular offline não recebe partes', () => {
    const agora = Date.now()
    const simData = {
        A: { sim1: sim(), heartbeat: agora - 6 * 60 * 1000 },
        B: { sim1: sim(), heartbeat: agora }
    }
    const telemetria = {
        A: { papel: 'DISPARADOR_MEGAS' },
        B: { papel: 'DISPARADOR_MEGAS' }
    }
    const cap = montarCapacidade(simData, telemetria, ativosVazios(), 'S2-TESTE', { agora })
    const resultado = distribuirPartes([10240], cap)
    assert.equal(resultado.ok, true)
    assert.ok(resultado.atribuicoes.every(a => a.dispositivoId === 'B'))
})

test('papéis de pagamento e saldo ficam fora do envio de megas', () => {
    const agora = Date.now()
    const simData = {
        PAGAMENTO: { sim1: sim(), heartbeat: agora },
        SALDO: { sim1: sim(), heartbeat: agora }
    }
    const telemetria = {
        PAGAMENTO: { papel: 'RECEBER_PAGAMENTOS' },
        SALDO: { papel: 'DISPARADOR_SALDO' }
    }
    const cap = montarCapacidade(simData, telemetria, ativosVazios(), 'S2-TESTE', { agora })
    assert.equal(cap.ok, false)
    assert.equal(cap.motivo, 'sem-telemetria')
})

test('20 partes usam 10 envios por celular e o 10.º de cada um leva +2MB', () => {
    const agora = Date.now()
    const simData = {
        A: { sim1: sim(204800), heartbeat: agora },
        B: { sim1: sim(204800), heartbeat: agora }
    }
    const telemetria = {
        A: { papel: 'DISPARADOR_MEGAS' },
        B: { papel: 'DISPARADOR_MEGAS' }
    }
    const cap = montarCapacidade(simData, telemetria, ativosVazios(), 'S2-TESTE', { agora })
    const resultado = distribuirPartes(Array(20).fill(10240), cap)
    assert.equal(resultado.ok, true)
    const porDispositivo = resultado.atribuicoes.reduce((acc, a) => {
        acc[a.dispositivoId] = (acc[a.dispositivoId] || 0) + 1
        return acc
    }, {})
    assert.deepEqual(porDispositivo, { A: 10, B: 10 })
    const decimos = resultado.atribuicoes.filter(a => a.ajuste10 === 2)
    assert.equal(decimos.length, 2)
    assert.ok(decimos.every(a => a.mbEnvio === 10242))
})

test('reassentamento usa a parte exibida e nunca envia acima de 10240', () => {
    assert.equal(baseMbDoPedido({ mbExibicao: 10240, megasAmount: 10242 }), 10240)
    assert.equal(baseMbDoPedido({ megasAmount: 10242 }), 10240)
    assert.equal(baseMbDoPedido({ megasAmount: 5120 }), 5120)
})
