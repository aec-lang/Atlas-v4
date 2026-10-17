import { describe, it, expect } from 'vitest'
import { useActivityStore } from '@/stores/activityStore'
import { useConversationsStore } from '@/stores/conversationsStore'
import { useMessagesStore } from '@/stores/messagesStore'

describe('activityStore — محدودیت حافظهٔ اسکرین‌شات', () => {
  it('اسکرین‌شاتهای قدیمی‌تر از ۵ تا را از حافظه پاک میکند', () => {
    const store = useActivityStore.getState()
    store.clear()
    for (let i = 0; i < 12; i++) {
      store.push({ id: `s${i}`, tool: 'screen_capture', ts: Date.now() + i, screenshot: `data:img${i}` })
    }
    const entries = useActivityStore.getState().entries
    expect(entries.length).toBe(12)
    const withShot = entries.filter(e => e.screenshot).length
    expect(withShot).toBeLessThanOrEqual(5)
    // جدیدترین‌ها (ایندکس ۰) اسکرین‌شات را حفظ میکنند
    expect(entries[0].screenshot).toBeTruthy()
  })
})

describe('conversationsStore — ساخت مکالمه', () => {
  it('شناسهٔ یکتا برمیگرداند و به لیست اضافه میکند', () => {
    const before = useConversationsStore.getState().conversations.length
    const id = useConversationsStore.getState().create()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(3)
    const after = useConversationsStore.getState().conversations
    expect(after.length).toBe(before + 1)
    expect(after.some(c => c.id === id)).toBe(true)
  })
})

describe('conversationsStore — ضداسپم «مکالمهٔ جدید»', () => {
  it('کلیک‌های مکرر روی مکالمهٔ خالی، مکالمهٔ تکراری نمی‌سازد', () => {
    const s = useConversationsStore.getState()
    const before = s.conversations.length
    const id1 = s.create()
    const id2 = useConversationsStore.getState().create()
    const id3 = useConversationsStore.getState().create()
    expect(id2).toBe(id1)
    expect(id3).toBe(id1)
    expect(useConversationsStore.getState().conversations.length).toBeLessThanOrEqual(before + 1)
  })

  it('وقتی جدیدترین مکالمه پیام ذخیره‌شده دارد، مکالمهٔ تازه می‌سازد', () => {
    const s = useConversationsStore.getState()
    const id1 = s.create()
    useMessagesStore.getState().save(id1, { messages: [{ message: { id: 'm1' }, parentId: null }] })
    const id2 = useConversationsStore.getState().create()
    expect(id2).not.toBe(id1)
    expect(useConversationsStore.getState().conversations[0].id).toBe(id2)
  })

  it('پیامهای زندهٔ هنوز-ذخیره‌نشده هم مکالمه را «پر» حساب می‌کند', () => {
    const s = useConversationsStore.getState()
    const id = s.create()
    s.setLiveCount(id, 3)
    const id2 = useConversationsStore.getState().create()
    expect(id2).not.toBe(id)
    useConversationsStore.getState().setLiveCount(id, 0)
  })
})
