# SharePoint Sensitivity Label Report

Prototype P0–P3 สำหรับรายงานไฟล์ที่ติด Microsoft Purview Sensitivity Label
ภายใต้ SharePoint hierarchy scope ของผู้ใช้

## Local development

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run lint
npm run typecheck
npm test
```

Prototype ใช้ deterministic fixtures และ cached store contracts เท่านั้น
ยังไม่มี Microsoft Graph credentials หรือ production tenant configuration
