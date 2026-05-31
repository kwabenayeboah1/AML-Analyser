  <img src="https://images.unsplash.com/photo-1589994965851-a8f479c573a9?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D" width="100%">
</p>

  # AML Analysis & SIC Code Matching ⚖️📊

This workspace automatically ingests heavy judicial documents (in PDF format), cross-references active entities against localized Standard Industrial Classification (SIC) codes, and detects Money Laundering exposure. This can be used to determine whether certain businesses are more involved in AML crimes and establish guardrails in future legislation regarding how AML can be prevented.

---

## 🚀 Key Features

* **Multi-Format Batch Ingestion:** Seamlessly drag-and-drop multiple court logs (.pdf) simultaneously with responsive tracking queues.
* **Tailored SIC Categorization:** Build, edit, or reset target lists of corporate operational sectors. Supports bulk CSV imports for enterprise taxonomies.
* **Double-Verification Compliance Detection:** Detects and separates active money laundering incidents into distinct risk severity classes:
  * 🔴 **Confirmed:** Concrete sentencing or conviction details.
  * 🟠 **Alleged:** Open allegations, pending hearings, or charges.
  * 🔵 **Discussed/Precedent:** Referenced as academic, legal, or procedural precedent.
  * ⚫ **None:** Zero matched risk exposure.
* **Resilient Connection Architecture (Cancel/Abort):** Native stream-interruption utilizing JavaScript `AbortController` signals. You can cancel heavy document analyses instantly, immediately freeing up system resources.
* **Intelligent Rate-Limit Mitigation:** Evaluates document size prior to dispatch and applies adaptive "cooling" steps to prevent throttling timeouts (429 errors).
* **Selection-Based Excel Exports:** Checkbox-selection allows compliance auditors to choose specific legal matches to compile into standardized spreadsheets.

---

## ⚙️ Technical Design & Architecture

### **Streamlined Operations Pipeline**
1. **Extraction:** Browser file ingestion handles asynchronous reading of dense PDF matrices into base64 streams.
2. **Contextual Analysis (Gemini 3.1 Pro):** Deep structural verification processes facts while separating relevant financial actor insights from secondary legal citations.
3. **Robust Retry Controls:** Integrates a customizable exponential backoff algorithm that isolates transient server issues without interrupting local state.
4. **Local Storage Buffer:** Results are cached, ensuring search queries, previous analysis records, and customized SIC standards remain local to the enterprise browser context.

---

## 🛠️ Tech Stack

* **UI/UX Architecture:** React (with Vite), Tailwind CSS (fluent-styling layout).
* **Interactions & Animations:** Motion (Framer Motion), Lucide React.
* **AI Engine:** Google GenAI SDK (Gemini 3.1 Pro Preview).
* **Data Compiler:** XLSX SheetJS engine.

---

## ⬇️ Setup Instructions
 
   # Run and deploy your AI Studio app

## Run Locally

**Prerequisites:**  Node.js

Please ensure you clone this repository first before following the steps below:

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
