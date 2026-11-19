# Accessibility Design — সহজে ব্যবহার

লক্ষ্য: সব বয়সের ব্যবহারকারী যেন সহজে অ্যাপ ব্যবহার করতে পারেন। মান: **WCAG 2.2 AA**।
Goal: people of every age can use the app with ease. Target: **WCAG 2.2 AA**.

ব্যবহারকারী নিজে বদলাতে পারেন: **সেটিং → সহজে ব্যবহার** (লেখার আকার, বেশি স্পষ্ট রঙ, কম অ্যানিমেশন)। এগুলো শুধু ওই ডিভাইসে মনে থাকে।

| নাম | কাজ | যেভাবে করা হয়েছে | কোথায় |
|---|---|---|---|
| Accessibility | সবার ব্যবহার উপযোগী | সব নিয়ম একটি স্তরে, সব পাতায় একসাথে কাজ করে | `web/src/a11y.css`, `web/src/lib/a11y.ts` |
| Readable Typography | সহজপাঠ্য লেখা | বাংলায় লাইনের ফাঁক ১.৬৫; ৫টি বাংলা ফন্ট থেকে বেছে নেওয়া; বড় লেখায় শব্দ কাটে না, নিচে নেমে যায় | `theme.css`, `a11y.css` |
| Contrast Ratio | যথেষ্ট রঙের Contrast | লেখা ≥ ৪.৫:১, বক্সের দাগ ও ফোকাস রিং ≥ ৩:১; ডার্ক মোডে সবুজ বাটনের লেখা গাঢ় (৬.২:১); "বেশি স্পষ্ট রঙ" সেটিং ও ফোনের *Increase contrast* মানে; Windows High Contrast-এও আকার দেখা যায় | `--on-primary`, `--in-border`, `--in-ph`, `data-contrast` |
| Touch Accessibility | সহজে Button চাপা | টাচ স্ক্রিনে প্রতিটি বাটন/লিংক কমপক্ষে ৪৪×৪৪ px (ছোট বাটন ৪০ px); চেকবক্স ২২ px; ডাবল-ট্যাপ জুমের দেরি নেই | `@media (pointer:coarse)` |
| Screen Reader Support | স্ক্রিন রিডার | আইকন বাটনে নাম; নতুন পাতায় গেলে পাতার নাম পড়ে শোনায়; নতুন নোটিফিকেশন ঘোষণা; গোনা সংখ্যা ("৩টি অপেক্ষায়") বাটনের নামে; TalkBack/NVDA | `announce()`, `usePageFocus()` |
| Semantic HTML | সঠিক HTML Structure | `header`, `nav`, `main`, `aside` ল্যান্ডমার্ক; প্রতি পাতায় একটি `h1`; ডায়ালগ `role=dialog` + শিরোনাম দিয়ে নাম; বাটনের ভেতরে বাটন নেই; ভাষা বাটনে `lang` | `AppShell.tsx`, `ui.tsx` |
| Focus Management | Keyboard Navigation | প্রথম Tab-এ "মূল অংশে যান"; মোটা ফোকাস রিং (শুধু কিবোর্ডে); ডায়ালগে ফোকাস ঢোকে, Tab বাইরে যায় না, Esc বন্ধ করে, ফোকাস খোলার বাটনে ফেরে; প্রোফাইল মেনুতে ↑ ↓ Home End; ফোনের মেনু খুললে ফোকাস মেনুতে | `useDialog()`, `menuKeys()` |
| Reduced Motion | কম Animation | ফোনের *Reduce motion* বা অ্যাপের "কম অ্যানিমেশন" — সব অ্যানিমেশন, ঝলকানি ও ধীরে স্ক্রল বন্ধ | `data-motion`, `scrollBehavior()` |
| Scalable Text | প্রয়োজনমতো লেখা বড় করা | সব ফন্ট সাইজ `rem`-এ, তাই ফোন/ব্রাউজারের লেখার আকার মানে; অ্যাপে ৪ ধাপ: ১০০% · ১১৩% · ১২৫% · ১৩৮% | `data-text` |
| Accessible Forms | সহজে ফর্ম পূরণ | প্রতিটি বক্সের লেবেল; আবশ্যক ঘর স্ক্রিন রিডারে "আবশ্যক"; ভুলের বার্তা বক্সের সাথে যুক্ত (`aria-describedby`) ও ⚠ চিহ্নসহ (শুধু রঙে নয়); সাহায্যের লেখা বক্সের সাথে পড়া হয়; খোঁজা যায় এমন ড্রপডাউনে তীর চাপলে স্ক্রিন রিডার বাছাই পড়ে (`aria-activedescendant`); প্লেসহোল্ডার পড়া যায় এমন রঙে | `inputs.tsx`, `Field` |

## For developers

- **New dialog:** use `Modal` from `pages/accounts/ui.tsx`, or call `useDialog(ref, onClose)` on your own `role="dialog"` element.
- **Smooth scrolling:** write `behavior: scrollBehavior()` (from `lib/a11y`), never `'smooth'`.
- **Font sizes:** write them in `rem` (16 px = 1rem), never `px`, so text can grow.
- **Colours:** text on a `var(--primary)` background uses `color: var(--on-primary)`, not `#fff`.
- **Icon-only buttons** need `aria-label`; a menu with `role="menu"` needs `role="menuitem"` items and `onKeyDown={menuKeys}`.
- **Say something to a screen reader:** `announce('সেভ হয়েছে')`.
- `npm run test:smoke` checks the dialog focus trap, skip link, text size, contrast and motion settings at PC and phone size.

Still to do before go-live: automated axe-core scan of every page per role, and a manual TalkBack / NVDA pass.
