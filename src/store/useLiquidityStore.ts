import {
  ApiV3PoolInfoStandardItem,
  ApiV3PoolInfoConcentratedItem,
  CreateCpmmPoolAddress,
  ApiV3Token,
  FormatFarmInfoOutV6,
  toToken,
  TokenAmount,
  Percent,
  setLoggerLevel,
  LogLevel
} from '@raydium-io/raydium-sdk-v2'
import createStore from './createStore'
import { useAppStore } from './useAppStore'
import { toastSubject } from '@/hooks/toast/useGlobalToast'
import { txStatusSubject } from '@/hooks/toast/useTxStatus'
import { getDefaultToastData, transformProcessData, handleMultiTxToast } from '@/hooks/toast/multiToastUtil'
import { TxCallbackProps } from '@/types/tx'
import { formatLocaleStr } from '@/utils/numberish/formatter'

import { getTxMeta } from './configs/liquidity'
import { getMintSymbol } from '@/utils/token'
import getEphemeralSigners from '@/utils/tx/getEphemeralSigners'
import { getPoolName } from '@/features/Pools/util'
import { handleMultiTxRetry } from '@/hooks/toast/retryTx'
import BN from 'bn.js'
import Decimal from 'decimal.js'
import { getComputeBudgetConfig } from '@/utils/tx/computeBudget'
setLoggerLevel('Raydium_cpmm', LogLevel.Debug)
interface LiquidityStore {
  newCreatedPool?: CreateCpmmPoolAddress
  addLiquidityAct: (
    params: {
      poolInfo: ApiV3PoolInfoStandardItem
      amountA: string
      amountB: string
      fixedSide: 'a' | 'b'
    } & TxCallbackProps
  ) => Promise<string>
  addCpmmLiquidityAct: (
    params: {
      poolInfo: ApiV3PoolInfoStandardItem
      inputAmount: string
      anotherAmount: string
      liquidity: string
      baseIn: boolean
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
  removeCpmmLiquidityAct: (
    params: {
      poolInfo: ApiV3PoolInfoStandardItem
      lpAmount: string
      config?: {
        bypassAssociatedCheck?: boolean
      }
    } & TxCallbackProps
  ) => Promise<string>
  createPoolAct: (
    params: {
      pool: {
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

    addCpmmLiquidityAct: async ({ onSent, onError, onFinally, ...params }) => {
      const { raydium, txVersion, slippage } = useAppStore.getState()
      if (!raydium) return ''
      const baseIn = params.baseIn

      const { execute } = await raydium.cpmm.addLiquidity({
        ...params,
        inputAmount: new BN(new Decimal(params.inputAmount).mul(10 ** params.poolInfo[baseIn ? 'mintA' : 'mintB'].decimals).toFixed(0)),
        slippage: new Percent(slippage * 10000, 10000),
        txVersion
      })

      const meta = getTxMeta({
        action: 'addLiquidity',
        values: {
          amountA: formatLocaleStr(
            baseIn ? params.inputAmount : params.anotherAmount,
            params.poolInfo[baseIn ? 'mintA' : 'mintB'].decimals
          )!,
          symbolA: getMintSymbol({ mint: params.poolInfo.mintA, transformSol: true }),
          amountB: formatLocaleStr(
            baseIn ? params.anotherAmount : params.inputAmount,
            params.poolInfo[baseIn ? 'mintB' : 'mintA'].decimals
          )!,
          symbolB: getMintSymbol({ mint: params.poolInfo.mintB, transformSol: true })
        }
      })

      return execute()
        .then(({ txId, signedTx }) => {
          txStatusSubject.next({
            txId,
            ...meta,
            signedTx,
            mintInfo: [params.poolInfo.mintA, params.poolInfo.mintB],
            onError,
            onConfirmed: params.onConfirmed
          })
          onSent?.()
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ ...meta, txError: e })
          return ''
        })
        .finally(onFinally)
    },

    addLiquidityAct: async ({ onSent, onError, onFinally, ...params }) => {
      const { raydium, txVersion } = useAppStore.getState()
      if (!raydium) return ''

      const { execute } = await raydium.liquidity.addLiquidity({
        ...params,
        amountInA: new TokenAmount(
          toToken(params.poolInfo.mintA),
          new Decimal(params.amountA).mul(10 ** params.poolInfo.mintA.decimals).toFixed(0)
        ),
        amountInB: new TokenAmount(
          toToken(params.poolInfo.mintB),
          new Decimal(params.amountB).mul(10 ** params.poolInfo.mintB.decimals).toFixed(0)
        ),
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
        .then(({ txId, signedTx }) => {
          txStatusSubject.next({
            txId,
            ...meta,
            signedTx,
            mintInfo: [params.poolInfo.mintA, params.poolInfo.mintB],
            onError,
            onConfirmed: params.onConfirmed
          })
          onSent?.()
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ ...meta, txError: e })
          return ''
        })
        .finally(onFinally)
    },

    removeLiquidityAct: async ({ onSent, onError, onFinally, ...params }) => {
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
        .then(({ txId, signedTx }) => {
          txStatusSubject.next({ txId, ...meta, signedTx, mintInfo: [params.poolInfo.mintA, params.poolInfo.mintB], onError })
          onSent?.()
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ ...meta, txError: e })
          return ''
        })
        .finally(onFinally)
    },

    removeCpmmLiquidityAct: async ({ onSent, onError, onFinally, ...params }) => {
      const { raydium, txVersion, slippage } = useAppStore.getState()

      if (!raydium) return ''
      const { poolInfo, lpAmount } = params

      const { execute } = await raydium.cpmm.withdrawLiquidity({
        poolInfo,
        lpAmount: new BN(lpAmount),
        slippage: new Percent(slippage * 10000, 10000),
        txVersion
      })

      const percent = new Decimal(lpAmount).div(10 ** poolInfo.lpMint.decimals).div(poolInfo?.lpAmount || 1)

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
        .then(({ txId, signedTx }) => {
          txStatusSubject.next({ txId, ...meta, signedTx, mintInfo: [params.poolInfo.mintA, params.poolInfo.mintB], onError })
          onSent?.()
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ ...meta, txError: e })
          return ''
        })
        .finally(onFinally)
    },

    createPoolAct: async ({ pool, baseAmount, quoteAmount, startTime, onSent, onError, onFinally, onConfirmed }) => {
      const { raydium, programIdConfig, txVersion } = useAppStore.getState()
      if (!raydium) return ''
      const computeBudgetConfig = await getComputeBudgetConfig()

      const { execute, extInfo } = await raydium.cpmm.createPool({
        programId: programIdConfig.CREATE_CPMM_POOL_PROGRAM,
        poolFeeAccount: programIdConfig.CREATE_CPMM_POOL_FEE_ACC,
        mintA: pool.mintA,
        mintB: pool.mintB,
        mintAAmount: new BN(baseAmount),
        mintBAmount: new BN(quoteAmount),
        startTime: new BN((startTime ? Number(startTime) : Date.now() + 60 * 1000) / 1000),
        ownerInfo: {
          useSOLBalance: true
        },
        associatedOnly: false,
        txVersion,
        computeBudgetConfig
      })

      const meta = getTxMeta({
        action: 'createPool',
        values: {
          mintA: getMintSymbol({ mint: pool.mintA, transformSol: true }),
          mintB: getMintSymbol({ mint: pool.mintB, transformSol: true })
        }
      })

      const handleConfirmed = () => {
        onConfirmed?.()
        set({ newCreatedPool: extInfo.address })
      }

      return execute()
        .then(({ txId, signedTx }) => {
          txStatusSubject.next({
            txId,
            ...meta,
            signedTx,
            mintInfo: [pool.mintA, pool.mintB],
            onSent,
            onError,
            onConfirmed: handleConfirmed
          })
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ txError: e })
          return ''
        })
        .finally(onFinally)
    },

    migrateToClmmAct: async ({ onSent, onError, onFinally, onConfirmed, ...params }) => {
      const { raydium, txVersion, wallet, connection, signAllTransactions } = useAppStore.getState()
      if (!raydium || !connection || !signAllTransactions) return ''

      const computeBudgetConfig = await getComputeBudgetConfig()
      const { execute, transactions } = await raydium.liquidity.removeAllLpAndCreateClmmPosition({
        ...params,
        createPositionInfo: {
          ...params.createPositionInfo,
          tickLower: Math.min(params.createPositionInfo.tickLower, params.createPositionInfo.tickUpper),
          tickUpper: Math.max(params.createPositionInfo.tickLower, params.createPositionInfo.tickUpper)
        },
        computeBudgetConfig,
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

      const txLength = transactions.length
      const { toastId, processedId, handler } = getDefaultToastData({
        txLength,
        onSent,
        onError,
        onFinally,
        onConfirmed
      })
      const getSubTxTitle = (idx: number) => (idx === transactions.length - 1 ? migrateMeta.title : removeMeta.title)

      return execute({
        sequentially: true,
        onTxUpdate: (data) => {
          handleMultiTxRetry(data)
          handleMultiTxToast({
            toastId,
            processedId: transformProcessData({ processedId, data }),
            txLength,
            meta: migrateMeta,
            handler,
            getSubTxTitle
          })
        }
      })
        .then(({ txIds }) => {
          handleMultiTxToast({
            toastId,
            processedId: transformProcessData({ processedId, data: [] }),
            txLength,
            meta: migrateMeta,
            handler,
            getSubTxTitle
          })
          return txIds[0]
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ txError: e, ...migrateMeta })
          return ''
        })
    },

    computePairAmount: ({ pool, amount, baseIn }) => {
      const { raydium, slippage, programIdConfig } = useAppStore.getState()
      if (!raydium)
        return {
          output: '0',
          maxOutput: '0',
          liquidity: new BN(0)
        }

      const isCpmm = pool.programId === programIdConfig.CREATE_CPMM_POOL_PROGRAM.toBase58()
      const params = {
        poolInfo: pool,
        amount,
        baseIn,
        slippage: new Percent(slippage * 10000, 10000)
      }
      const r = isCpmm ? raydium.cpmm.computePairAmount(params) : raydium.liquidity.computePairAmount(params)

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
