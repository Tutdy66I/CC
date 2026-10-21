import { measureEvm, type ReferenceSample } from '../lib/evm'

export default function EvmReadout({
  reference,
  received,
  modulation,
}: {
  reference: readonly ReferenceSample[]
  received: readonly ReferenceSample[]
  modulation: string
}) {
  const evm = measureEvm(reference, received)
  return (
    <p aria-label={`${modulation} EVM 测量`}>
      RMS EVM：<strong>{evm.percent.toFixed(3)}%</strong>（
      {evm.db === null ? '−∞' : evm.db.toFixed(2)} dB）。
      以实际发送采样为参考，按全部输入统计；不作增益、相位或频偏补偿。
      {modulation === 'BPSK' &&
        ' 当前 BPSK 仅测实轴误差，不等同于二维射频 EVM。'}
    </p>
  )
}
