import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MODELS, appError, installFakeSvs } from '../../test/fake-svs'
import { ProjectModelsSection } from './project-models-section'

afterEach(cleanup)

const PROJECT = { name: '海邊的貓', models: {} }

describe('ProjectModelsSection', () => {
  it('寫出只套用在哪個專案；每列第一個選項是「跟著預設（上面選的模型）」', () => {
    installFakeSvs()
    render(
      <ProjectModelsSection
        project={PROJECT}
        models={MODELS}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.getByTestId('project-models-section').textContent).toContain(
      '只套用在「海邊的貓」',
    )
    const row = screen.getByTestId('project-model-t2i')
    expect(row.dataset.value).toBe('follow-app')
    expect(row.textContent).toContain('跟著預設')
    expect(row.textContent).toContain('Nano Banana 2')
    fireEvent.click(row)
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual([
      '跟著預設（Nano Banana 2）',
      'Nano Banana 2（推薦）・每張約 US$0.08（估算）',
      'Seedream 5.0・每張約 US$0.04',
    ])
  })

  it('這個用途沒有可用的模型時，「跟著預設」寫沒有可用的模型', () => {
    installFakeSvs()
    render(
      <ProjectModelsSection project={PROJECT} models={MODELS} selected={{}} onChanged={vi.fn()} />,
    )
    expect(screen.getByTestId('project-model-llm').textContent).toContain('沒有可用的模型')
  })

  it('選一個模型 → 存到這個專案；選「跟著預設」→ 送 null 改回跟著上面', async () => {
    const svs = installFakeSvs({ 'models.setProject': () => ({}) })
    const onChanged = vi.fn()
    const { rerender } = render(
      <ProjectModelsSection
        project={PROJECT}
        models={MODELS}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={onChanged}
      />,
    )
    fireEvent.click(screen.getByTestId('project-model-t2i'))
    fireEvent.click(screen.getByTestId('project-model-t2i-option-fal/seedream-5.0'))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1)
    })
    rerender(
      <ProjectModelsSection
        project={{ ...PROJECT, models: { t2i: 'fal/seedream-5.0' } }}
        models={MODELS}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={onChanged}
      />,
    )
    expect(screen.getByTestId('project-model-t2i').dataset.value).toBe('fal/seedream-5.0')
    fireEvent.click(screen.getByTestId('project-model-t2i'))
    fireEvent.click(screen.getByTestId('project-model-t2i-option-follow-app'))
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(2)
    })
    expect(svs.payloadsOf('models.setProject')).toEqual([
      { models: { t2i: 'fal/seedream-5.0' } },
      { models: { t2i: null } },
    ])
  })

  it('主行程拒絕時顯示訊息', async () => {
    installFakeSvs({
      'models.setProject': () => {
        throw appError('請先開啟或建立一個專案。')
      },
    })
    render(
      <ProjectModelsSection
        project={PROJECT}
        models={MODELS}
        selected={{ t2i: 'fal/nano-banana-2' }}
        onChanged={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('project-model-t2i'))
    fireEvent.click(screen.getByTestId('project-model-t2i-option-fal/seedream-5.0'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('請先開啟')
    })
  })
})
