import {
  ApiV3PoolInfoStandardItem,
  ApiV3PoolInfoConcentratedItem,
  CreatePoolAddress,
  Percent,
  ApiV3Token,
  FormatFarmInfoOutV6
} from '@raydium-io/raydium-sdk-v2'
import { v4 as uuid } from 'uuid'
import createStore from './createStore'
import { useAppStore } from './useAppStore'
import { toastSubject } from '@/hooks/toast/useGlobalToast'
import { txStatusSubject, multiTxStatusSubject } from '@/hooks/toast/useTxStatus'

import { PublicKey } from '@solana/web3.js'
import { TxCallbackProps } from '@/types/tx'
import { formatLocaleStr } from '@/utils/numberish/formatter'

import { getTxMeta } from './configs/liquidity'
import { getMintSymbol } from '@/utils/token'
import getEphemeralSigners from '@/utils/tx/getEphemeralSigners'
import { getPoolName } from '@/features/Pools/util'

import BN from 'bn.js'
import Decimal from 'decimal.js'

interface LiquidityStore {
  newCreatedPool?: CreatePoolAddress
  addLiquidityAct: (
    params: {
      poolInfo: ApiV3PoolInfoStandardItem
      amountA: string
      amountB: string
      fixedSide: 'a' | 'b'
    } & TxCallbackProps
  ) => Promise<string>
  removeLiquidityAct: (
    params: {
      poolInfo: ApiV3PoolInfoStandardItem
      amount: string
      config?: {
        bypassAssociatedCheck?: boolean
      }
    } & TxCallbackProps
  ) => Promise<string>
  createPoolAct: (
    params: {
      pool: {
        marketId: string
        mintA: ApiV3Token
        mintB: ApiV3Token
      }
      baseAmount: string
      quoteAmount: string
      startTime?: Date
    } & TxCallbackProps
  ) => Promise<string>

  migrateToClmmAct: (
    params: {
      poolInfo: ApiV3PoolInfoStandardItem
      clmmPoolInfo: ApiV3PoolInfoConcentratedItem
      removeLpAmount: BN
      createPositionInfo: {
        tickLower: number
        tickUpper: number
        baseAmount: BN
        otherAmountMax: BN
      }
      farmInfo?: FormatFarmInfoOutV6
      userFarmLpAmount?: BN
      base: 'MintA' | 'MintB'
    } & TxCallbackProps
  ) => Promise<string>

  computePairAmount: (params: { pool: ApiV3PoolInfoStandardItem; amount: string; baseIn: boolean }) => {
    output: string
    maxOutput: string
    liquidity: BN
  }

  resetComputeStateAct: () => void
}

const initLiquiditySate = {
  poolList: [],
  poolMap: new Map()
}

export const useLiquidityStore = createStore<LiquidityStore>(
  (set) => ({
    ...initLiquiditySate,

    addLiquidityAct: async ({ onSuccess, onError, onFinally, ...params }) => {
      const { raydium, txVersion } = useAppStore.getState()
      if (!raydium) return ''
      const { execute } = await raydium.liquidity.addLiquidity({
        ...params,
        amountInA: params.amountA,
        amountInB: params.amountB,
        txVersion
      })

      const meta = getTxMeta({
        action: 'addLiquidity',
        values: {
          amountA: formatLocaleStr(params.amountA, params.poolInfo.mintA.decimals)!,
          symbolA: getMintSymbol({ mint: params.poolInfo.mintA, transformSol: true }),
          amountB: formatLocaleStr(params.amountB, params.poolInfo.mintB.decimals)!,
          symbolB: getMintSymbol({ mint: params.poolInfo.mintB, transformSol: true })
        }
      })

      return execute()
        .then((txId) => {
          txStatusSubject.next({
            txId,
            ...meta,
            mintInfo: [params.poolInfo.mintA, params.poolInfo.mintB],
            onError,
            onConfirmed: params.onConfirmed
          })
          onSuccess?.()
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ ...meta, txError: e })
          return ''
        })
        .finally(onFinally)
    },

    removeLiquidityAct: async ({ onSuccess, onError, onFinally, ...params }) => {
      const { raydium, txVersion } = useAppStore.getState()

      if (!raydium) return ''
      const { poolInfo, amount, config } = params
      const { execute } = await raydium.liquidity.removeLiquidity({
        poolInfo,
        amountIn: new BN(amount),
        config,
        txVersion
      })

      const percent = new Decimal(amount).div(10 ** poolInfo.lpMint.decimals).div(poolInfo?.lpAmount || 1)

      const meta = getTxMeta({
        action: 'removeLiquidity',
        values: {
          amountA: formatLocaleStr(percent.mul(poolInfo?.mintAmountA || 0).toString(), params.poolInfo.mintA.decimals)!,
          symbolA: getMintSymbol({ mint: params.poolInfo.mintA, transformSol: true }),
          amountB: formatLocaleStr(percent.mul(poolInfo?.mintAmountB || 0).toString(), params.poolInfo.mintB.decimals)!,
          symbolB: getMintSymbol({ mint: params.poolInfo.mintB, transformSol: true })
        }
      })

      return execute()
        .then((txId) => {
          txStatusSubject.next({ txId, ...meta, mintInfo: [params.poolInfo.mintA, params.poolInfo.mintB], onError })
          onSuccess?.()
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ ...meta, txError: e })
          return ''
        })
        .finally(onFinally)
    },

    createPoolAct: async ({ pool, baseAmount, quoteAmount, startTime, onSuccess, onError, onFinally }) => {
      const { raydium, programIdConfig, txVersion } = useAppStore.getState()
      if (!raydium) return ''

      const { execute, extInfo } = await raydium.liquidity.createPoolV4({
        programId: programIdConfig.AMM_V4,
        marketInfo: {
          marketId: new PublicKey(pool.marketId),
          programId: programIdConfig.OPEN_BOOK_PROGRAM
        },
        baseMintInfo: {
          mint: new PublicKey(pool.mintA.address),
          decimals: pool.mintA.decimals
        },
        quoteMintInfo: {
          mint: new PublicKey(pool.mintB.address),
          decimals: pool.mintB.decimals
        },
        baseAmount: new BN(baseAmount),
        quoteAmount: new BN(quoteAmount),
        startTime: new BN((startTime ? Number(startTime) : Date.now() + 2 * 60 * 1000) / 1000),
        ownerInfo: {
          useSOLBalance: true
        },
        associatedOnly: false,
        txVersion,
        feeDestinationId: new PublicKey('7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5')
      })

      const meta = getTxMeta({
        action: 'createPool',
        values: {
          mintA: getMintSymbol({ mint: pool.mintA, transformSol: true }),
          mintB: getMintSymbol({ mint: pool.mintB, transformSol: true })
        }
      })

      return execute()
        .then((txId) => {
          set({ newCreatedPool: extInfo.address })
          txStatusSubject.next({ txId, ...meta, mintInfo: [pool.mintA, pool.mintB], onError })
          onSuccess?.()
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ txError: e })
          return ''
        })
        .finally(onFinally)
    },

    migrateToClmmAct: async ({ onSuccess, onError, onFinally, ...params }) => {
      const { raydium, txVersion, wallet, connection, signAllTransactions } = useAppStore.getState()
      if (!raydium || !connection || !signAllTransactions) return ''

      const { execute, transactions } = await raydium.liquidity.removeAllLpAndCreateClmmPosition({
        ...params,
        createPositionInfo: {
          ...params.createPositionInfo,
          tickLower: Math.min(params.createPositionInfo.tickLower, params.createPositionInfo.tickUpper),
          tickUpper: Math.max(params.createPositionInfo.tickLower, params.createPositionInfo.tickUpper)
        },
        getEphemeralSigners: wallet ? await getEphemeralSigners(wallet) : undefined,
        txVersion
      })

      const removeMeta = getTxMeta({
        action: 'removeLpBeforeMigrate'
      })

      const migrateMeta = getTxMeta({
        action: 'migrateToClmm',
        values: { mint: getPoolName(params.poolInfo) }
      })

      let toasted = false
      let errorCalled = false
      return execute({
        sequentially: true,
        onTxUpdate: (data) => {
          if (data.some((tx) => tx.status === 'error') && !errorCalled) {
            errorCalled = true
            onError?.()
          }
          if (data.length === transactions.length && !toasted) {
            onSuccess?.()
            toasted = true

            if (transactions.length > 1) {
              multiTxStatusSubject.next({
                toastId: uuid(),
                ...migrateMeta,
                subTxIds: data.map(({ txId, status }, idx) => ({
                  txId,
                  status: status !== 'sent' ? status : undefined,
                  ...(idx === transactions.length - 1 ? migrateMeta : removeMeta)
                }))
              })
              return
            }
            txStatusSubject.next({
              txId: data[0].txId,
              ...migrateMeta,
              onError,
              onConfirmed: params.onConfirmed
            })
          }
        }
      })
        .then((txId) => txId[0])
        .catch((e) => {
          onError?.()
          toastSubject.next({ txError: e, ...migrateMeta })
          return ''
        })
        .finally(onFinally)
    },

    computePairAmount: ({ pool, amount, baseIn }) => {
      const { raydium, slippage } = useAppStore.getState()
      if (!raydium)
        return {
          output: '0',
          maxOutput: '0',
          liquidity: new BN(0)
        }
      const r = raydium.liquidity.computePairAmount({
        poolInfo: pool,
        amount,
        baseIn,
        slippage: new Percent(slippage * 10000, 100000)
      })

      return {
        output: r.anotherAmount.toExact(),
        maxOutput: r.maxAnotherAmount.toExact(),
        liquidity: r.liquidity
      }
    },

    resetComputeStateAct: () => {
      set({}, false, { type: 'resetComputeStateAct' })
    }
  }),
  'useLiquidityStore'
)
