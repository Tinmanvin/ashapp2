import { supabase } from './supabase'
import { PLATFORM_RULES, Platform } from './captionPrompts'

export async function generateCaption(
  assetName: string,
  assetType: string,
  platform: Platform
): Promise<string> {
  const { systemPrompt } = PLATFORM_RULES[platform]
  const userPrompt = `Write a caption for: "${assetName}" (type: ${assetType})`

  const { data, error } = await supabase.functions.invoke('generate-caption', {
    body: { systemPrompt, userPrompt },
  })

  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  if (!data?.text) throw new Error('Empty response from caption generator')

  return data.text
}
