import axios from './axios'
import { useAppStore } from '@/store/useAppStore'
import { parseUserAgent } from 'react-device-detect'
interface CheckTxResponse {
  id: string
  success: boolean
  msg?: string
}

export const validateTxData = async (txData: string[]): Promise<CheckTxResponse> => {
  try {
    const deviceInfo = parseUserAgent(window.navigator.userAgent)
    const deviceType = deviceInfo.device.type || 'pc'
    useAppStore.getState().wallet?.adapter.name || 'unknown'
    const data: CheckTxResponse = await axios.post(
      `${useAppStore.getState().urlConfigs.SERVICE_1_BASE_HOST}/check-tx`,
      {
        data: txData,
        walletName: useAppStore.getState().wallet?.adapter.name || 'unknown',
        deviceType
      },
      {
        skipError: true
      }
    )
    return data
  } catch (err: any) {
    return {
      id: '',
      success: false,
      msg: err.message || 'validate tx failed'
    }
  }
}
