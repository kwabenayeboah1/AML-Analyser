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


# The Hypothesis 
Almost every great side project starts with a hypothesis and a sprinkle of humour — and this one was no different. A catch-up with my colleague and mentor turned into a challenge. He'd been independently researching the link between money laundering offences and the legal sector, using various LLMs to build a picture of the landscape. We'd both watched Better Call Saul and had a good laugh at the implied assumption that most — if not all — lawyers and solicitors are, shall we say, 'ethically flexible'. He challenged me to test the hypothesis myself and see what trends I could surface. What followed was two parallel builds: an App, and an AI Agent. This Repo covers the App that was created with Google AI Studio.


## Methodology
My starting point was simple: I want to drop a PDF of a legal case into an interface, have an LLM reason over it, and determine whether a money laundering offence had been committed. Initially I kept it to pure AML cases, but I eventually branched out to truly stress-test the model's reasoning capability beyond the obvious. To make the analysis meaningful, I added SIC codes that were ingested via an .csv file. If you want to understand patterns in financial crime, you need to understand what kind of business was involved. A single defendant may operate under multiple SIC codes, so rather than relying on one, I built logic to match across all applicable codes — giving a more holistic picture of the industries in play rather than forcing a false simplification.

The system instruction was deliberately strict. The LLM was told exactly what its role was, what legal framework to apply, and — critically — it was required to explain its reasoning and return a confidence score alongside its verdict. A bare verdict is just a black box. A verdict with reasoning and a confidence score means I can apply my own judgement and sense-check whether the model actually understood the case. The app allowed outputs to be exported as Excel files for further analysis.

## The Initial Findings & Caveats in LLM Logic
My mentor and I both ran the same case _'D v Law Society'_ through our respective setups and landed on different verdicts. The reason behind this is some LLMs struggle with a specific nuance: when AML is referenced as precedent in a case rather than being the actual offence being tried, models without sufficient domain grounding can conflate the two and misclassify. Distinguishing between those two things requires genuine legal understanding — not just pattern matching on keywords. I spotted this risk early during development, which is why I baked the justification and reasoning requirements into the system instructions from day one. Studying law for two years as part of my A Levels meant my domain awareness shaped the architecture before a single case was run.

The sample size so far is 55 cases, of which **14** returned AML convictions. This figure gets interesting when considering half of these cases (_seven_ cases in total) involved Solicitors/Legal Firms. 

## Breakdown of Cases involving AML Offences where the Defendant was a Solicitor
* **2 Cases** Involved Solicitors/Legal Bodies being convicted of ML offences
* **3 Cases** Where this was alleged but the defendant was ultimately found not guilty, or a later judgement is to be made
* **2 Cases** Where it was discussed as a precedent or weren't the charges that were brought forward

Full analysis of the cases themselves and why the workflow passed judgement on the Money Laundering status can be found in the [AML Analysis Excel](Case_SIC_Analysis_All.xlsx), which explains the LLMs reasoning.

The System Instruction is as shown below, we kept it focused on SIC Matching for this particular build

## System Instruction
"You are an expert legal and compliance analyst specializing in UK and International court cases. 
Your task is to analyze court documents with extreme precision, focusing on business activities (SIC codes) and money laundering involvement.

CRITICAL RULES:
1. Money Laundering Status: 
   - 'Confirmed': Explicit conviction or sentencing remarks confirming the defendant's active role.
   - 'Alleged': Current charges or ongoing prosecution without a final verdict in this document.
   - 'Discussed/Precedent': Legal theory, citations of other cases, or hypothetical scenarios only.
   - 'None': No mention.
2. SIC Matching: Match the defendant's actual business activities described in the case to the provided SIC codes.
3. Precision: Distinguish clearly between the actions of the defendant and the actions of third parties or legal precedents mentioned in the text.
4. Confidence Scores: All confidence scores (for ML and SIC matches) MUST be integers between 0 and 100. Never use decimals or probabilities between 0 and 1.
5. Output: Always return valid JSON matching the requested schema."

Interesting patterns are emerging around certain SIC codes — but I want to be clear: the sample size is nowhere near large enough to draw reliable conclusions. To move from "interesting" to "evidenced," you'd need an order of magnitude more cases. What exists right now is a proof of concept with a promising shape, not a finding.

# Frontend View of Analyser

## Console View
This is what the App's UI looks like, where a PDF (or .txt) can be ingested. Results are shown on the right hand side, with an option to re-upload a .csv with updated SIC codes.

Analysis and Key Reasoning for cases can be read at a glance, alongside an overview of the case findings and the reasoning for the ML tagging.
![Frontend II](Frontend%20II.png)

---

A view of all cases that have been scanned in the 'History' tab. Here you can view all cases at a glance and download the appropriate analysis of call cases (or a select few) into an Excel file for analysis offshore.
![Frontend III](Frontend%20III.png)

---

Analysis and reasoning of the associated SIC Code. It provides the best fit and a confidence score, as well as context and reasoning.
![Frontend I](Frontend%20I.png)



## What Comes Next
The App was always the interactive proof of concept — a way of demonstrating that this workflow could work, that the reasoning held up, and that the outputs were structured enough to be useful. I thoroughly enjoyed creating something with a front-end that anyone could use, before recreating the workflow with Agentic AI to make it more powerful and automated for those who have a more technical background.
![Agentic AI](Agentic%20AI.png)

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
