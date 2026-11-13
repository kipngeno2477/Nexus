# Backup demo video: script (about 3 minutes)

Record against the deployed HTTPS URL (or `localhost` if the deployment is down; say so on camera).
Before recording: set `DEMO_FAILURES=true`, refresh the page once, and keep a small `.txt`
bylaw ready to upload (any real county bylaw, or the noisy sample in the appendix).
Each segment notes which challenge requirement it shows.

---

### 0:00 – 0:20 · What it is
**Show:** the home page.
**Say:** "Nexus answers plain-language questions about Kenya's Access to Information Act and
cites the exact section for every statement. It runs a fixed workflow (retrieve, synthesize,
cite, done) and it says so when the law doesn't cover a question."

### 0:20 – 0:50 · Grounded, cited answer *(retrieve → synthesize → cite)*
**Do:** click the example **"How much does it cost to request information?"**
**Show:** the green "Answered from the documents" banner, the claims with citation chips, and a
click on chip **1**, which highlights *12. Fees*. Click **Read full passage**.
**Say:** "Every claim is tied to a passage. No fee to apply; copying costs are capped at
actual cost; citations go to section 12."

### 0:50 – 1:20 · Heap top-K and the bounded workflow *(mandatory DSA)*
**Do:** expand **"How this answer was produced"**.
**Show:** the workflow trace (VALIDATE → RETRIEVE → GATE → SYNTHESIZE → VERIFY → DONE), the
stats (candidates scored vs K selected, heap replacements), and the **top-K table** sorted by
score with chunk ids.
**Say:** "BM25 scores every chunk; our own bounded min-heap keeps the best K. That's
O(n log K), it matches a full sort on every query, and ties break by document then chunk id.
Model calls are capped: two attempts, one repair, ten steps."

### 1:20 – 1:40 · Missing evidence *(report insufficient evidence)*
**Do:** click **"When are county elections held?"** (or type "How do I get a passport?").
**Show:** the amber "Not enough evidence" banner. Open the details panel: the gate stopped it,
or the model abstained.
**Say:** "It doesn't guess. Off-topic questions are stopped before the model is even called."

### 1:40 – 2:00 · Invalid input *(validate K)*
**Do:** set **Passages (K)** to `0` and ask anything.
**Show:** "Check your question: k must be an integer between 1 and 10."

### 2:00 – 2:25 · Model failure *(handle model/retrieval failure)*
**Do:** set K back to 4, choose **Simulate → model outage**, and ask a question.
**Show:** the red "Answer generator unavailable" banner **plus the retrieved source passages**;
in the details panel, 2 attempts and their errors.
**Say:** "If the model is down we retry within limits, then show the law itself instead of
failing." (Optional: **Simulate → search outage** shows "Search failed".)

### 2:25 – 2:55 · Messy document ingestion *(ingest noisy documents)*
**Do:** set Simulate back to *nothing*. Under **Your documents**, click **＋ Upload .txt** and
pick the noisy file. Open **Report**.
**Show:** page numbers and running headers removed, hyphenation repaired, sections found;
**Search in** switches to the new document. Ask a question about it and show the citation tagged
"your document".
**Say:** "Citizens can bring their own bylaw. It's cleaned, split into sections and searched
privately: it isn't shared, isn't stored, and is deleted after an hour."

### 2:55 – 3:05 · Close
**Show:** the Knowledge base drawer (the Act with its ingestion report) or `EVALUATION.md`.
**Say:** "27-question evaluation, 71 automated tests, deployed on PrimeCloud."

---

## Appendix: noisy sample file (synthetic, not a real bylaw)

Save as `sample-waste-bylaw.txt`:

```
SAMPLE COUNTY WASTE BYLAW (DEMO)
Page 1 of 2
SECTION 1 Collection days
Household refuse shall be collected every Tues-
day and Friday by the county.
SAMPLE COUNTY WASTE BYLAW (DEMO)
Page 2 of 2
SECTION 2 Fines
A person who dumps waste in a public place commits an offence and is liable to a fine not exceeding ten thousand shillings.
SAMPLE COUNTY WASTE BYLAW (DEMO)
SAMPLE COUNTY WASTE BYLAW (DEMO)
```

Question to ask: **"What is the fine for dumping waste in a public place?"** Expected answer:
up to ten thousand shillings, citing *SECTION 2 Fines*, tagged "your document".
