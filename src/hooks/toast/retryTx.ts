import { VersionedTransaction, Transaction } from '@solana/web3.js'
import { retry, idToIntervalRecord, cancelRetry } from '@/utils/common'
import { useAppStore } from '@/store'
import axios from '@/api/axios'

const retryRecord = new Map<
  string,
  {
    done: boolean
  }
>()

export default function retryTx({ tx, id }: { tx: Transaction | VersionedTransaction; id: string }) {
  const { connection, urlConfigs } = useAppStore.getState()
  if (retryRecord.has(id)) return
  try {
    axios.post(`${urlConfigs.SERVICE_BASE_HOST}${urlConfigs.SEND_TRANSACTION}`, {
      data: [tx.serialize({ verifySignatures: false }).toString('base64')]
    })
  } catch {
    console.error('send tx to be error')
  }
  if (!connection) return
  retryRecord.set(id, {
    done: false
  })
  retry(
    async () => {
      if (retryRecord.get(id)!.done) return true
      tx instanceof Transaction
        ? await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 0 })
        : await connection.sendTransaction(tx, { skipPreflight: true, maxRetries: 0 })
      throw new Error('sending')
    },
    {
      id,
      retryCount: 60,
      interval: 2000,
      sleepTime: 2000
    }
  ).catch((e) => {
    console.error('retry failed', e.message)
  })
}

export const cancelRetryTx = (txId: string) => {
  cancelRetry(idToIntervalRecord.get(txId))
  retryRecord.set(txId, { done: true })
}

export const handleMultiTxRetry = (
  processedData: {
    txId: string
    status: 'success' | 'error' | 'sent'
    signedTx: Transaction | VersionedTransaction
  }[]
) => {
  processedData.forEach((data) => {
    if (data.status === 'sent') {
      retryTx({ tx: data.signedTx, id: data.txId })
      return
    }
    cancelRetryTx(data.txId)
  })
}
