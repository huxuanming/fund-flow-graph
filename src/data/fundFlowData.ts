export type AccountType = 'normal' | 'suspicious' | 'core'

export interface AccountNode {
  id: string
  data: {
    name: string
    type: AccountType
    balance?: string
  }
}

export interface TransferEdge {
  id: string
  source: string
  target: string
  data: {
    amount: string
    date: string
  }
}

export interface FundFlowData {
  nodes: AccountNode[]
  edges: TransferEdge[]
}

export const fundFlowData: FundFlowData = {
  nodes: [
    { id: 'offshore',  data: { name: '境外账户\nOFFSHORE-001', type: 'suspicious', balance: '¥8,200万' } },
    { id: 'shell-a',   data: { name: '壳公司A\n香港注册',       type: 'suspicious', balance: '¥3,500万' } },
    { id: 'shell-b',   data: { name: '壳公司B\n开曼群岛',       type: 'suspicious', balance: '¥2,100万' } },
    { id: 'bank-1',    data: { name: '商业银行\n对公账户-01',   type: 'normal',     balance: '¥980万'   } },
    { id: 'bank-2',    data: { name: '商业银行\n对公账户-02',   type: 'normal',     balance: '¥1,200万' } },
    { id: 'bank-3',    data: { name: '城商行\n储蓄账户',        type: 'normal',     balance: '¥430万'   } },
    { id: 'core',      data: { name: '核心嫌疑人\n张某某',      type: 'core',       balance: '¥2,650万' } },
    { id: 'real-est',  data: { name: '地产公司\n收款账户',      type: 'normal',     balance: '¥1,800万' } },
    { id: 'crypto',    data: { name: '数字货币\n交易所账户',    type: 'suspicious', balance: '¥870万'   } },
  ],
  edges: [
    { id: 'e1',  source: 'offshore', target: 'shell-a',  data: { amount: '¥3,500万', date: '2024-01' } },
    { id: 'e2',  source: 'offshore', target: 'shell-b',  data: { amount: '¥2,100万', date: '2024-01' } },
    { id: 'e3',  source: 'shell-a',  target: 'bank-1',   data: { amount: '¥980万',   date: '2024-02' } },
    { id: 'e4',  source: 'shell-a',  target: 'bank-2',   data: { amount: '¥1,200万', date: '2024-02' } },
    { id: 'e5',  source: 'shell-b',  target: 'bank-2',   data: { amount: '¥560万',   date: '2024-02' } },
    { id: 'e6',  source: 'shell-b',  target: 'bank-3',   data: { amount: '¥430万',   date: '2024-03' } },
    { id: 'e7',  source: 'bank-1',   target: 'core',     data: { amount: '¥720万',   date: '2024-03' } },
    { id: 'e8',  source: 'bank-2',   target: 'core',     data: { amount: '¥1,400万', date: '2024-03' } },
    { id: 'e9',  source: 'bank-3',   target: 'core',     data: { amount: '¥380万',   date: '2024-03' } },
    { id: 'e10', source: 'core',     target: 'real-est', data: { amount: '¥1,800万', date: '2024-04' } },
    { id: 'e11', source: 'core',     target: 'crypto',   data: { amount: '¥870万',   date: '2024-04' } },
  ],
}
