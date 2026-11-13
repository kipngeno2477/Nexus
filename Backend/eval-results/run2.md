# Evaluation results

Run: 2026-11-13T06:53:08.010Z · corpus: 53 chunks / 1 document(s) · K=4 · model: qwen/qwen3.8-27b (fallback openai/gpt-oss-20b) · gate: coverage >= 0.6

## Retrieval (BM25 + bounded min-heap, no model)

| Recall@1 | @2 | @3 | @4 | @5 | @8 | MRR | heap == full sort |
|---|---|---|---|---|---|---|---|
| 73% | 86% | 91% | 91% | 91% | 95% | 0.818 | 27/27 queries identical |

Recall@K = share of the 22 answerable questions whose expected section is in the top K. Rank of first expected section per question: q01:1, q02:1, q03:1, q04:1, q05:1, q06:1, q07:1, q08:1, q09:1, q10:1, q11:1, q12:1, q13:2, q14:2, q15:1, q16:1, q17:6, q18:1, q19:1, q20:2, q21:3, q22:–, q23:–, q24:–, q25:–, q26:–, q27:–.

## Grounded answers (full pipeline)

| Metric | Value |
|---|---|
| Status correct (answered / abstained as expected) | 96% |
| Answered when the Act covers it | 95% |
| Abstained when it does not | 100% |
| Expected section in evidence (heap only / with cross-reference) | 91% / 91% |
| Key-fact recall in answers | 100% |
| Citation precision (cited section relevant) | 96% |
| Claims generated | 77 |
| Unsupported claims removed / flagged for review | 0 / 0 |
| Invented citations removed | 0 |
| Fabrication traps triggered | none |
| Stopped at retrieval gate (no model call) | 4 |
| Answered by fallback model / JSON repairs | 0 / 0 |
| Model latency p50 / p95 | 926 ms / 1369 ms |
| Total tokens | 37392 |

### Per question

| id | category | status | ok | facts | cites (precise) | model | ms |
|---|---|---|---|---|---|---|---|
| q01 | direct | answered | ✓ | 100% | 3 (100%) | qwen/qwen3.8-27b | 1255 |
| q02 | direct | answered | ✓ | 100% | 3 (100%) | qwen/qwen3.8-27b | 1369 |
| q03 | direct | answered | ✓ | 100% | 4 (75%) | qwen/qwen3.8-27b | 1004 |
| q04 | direct | answered | ✓ | 100% | 1 (100%) | qwen/qwen3.8-27b | 812 |
| q05 | direct | answered | ✓ | 100% | 2 (100%) | qwen/qwen3.8-27b | 1425 |
| q06 | direct | answered | ✓ | 100% | 1 (100%) | qwen/qwen3.8-27b | 525 |
| q07 | direct | answered | ✓ | 100% | 1 (100%) | qwen/qwen3.8-27b | 790 |
| q08 | direct | answered | ✓ | 100% | 2 (100%) | qwen/qwen3.8-27b | 1170 |
| q09 | direct | answered | ✓ | 100% | 2 (50%) | qwen/qwen3.8-27b | 1040 |
| q10 | direct | answered | ✓ | 100% | 2 (100%) | qwen/qwen3.8-27b | 1043 |
| q11 | direct | answered | ✓ | 100% | 1 (100%) | qwen/qwen3.8-27b | 1004 |
| q12 | direct | answered | ✓ | 100% | 2 (100%) | qwen/qwen3.8-27b | 728 |
| q13 | direct | answered | ✓ | 100% | 1 (100%) | qwen/qwen3.8-27b | 627 |
| q14 | direct | answered | ✓ | 100% | 1 (100%) | qwen/qwen3.8-27b | 534 |
| q15 | direct | answered | ✓ | 100% | 1 (100%) | qwen/qwen3.8-27b | 631 |
| q16 | paraphrase | answered | ✓ | 100% | 3 (100%) | qwen/qwen3.8-27b | 1146 |
| q17 | paraphrase | insufficient_evidence | ✗ | 0% | 0 | qwen/qwen3.8-27b | 527 |
| q18 | paraphrase | answered | ✓ | 100% | 1 (100%) | qwen/qwen3.8-27b | 584 |
| q19 | condition | answered | ✓ | 100% | 1 (100%) | qwen/qwen3.8-27b | 1290 |
| q20 | definition | answered | ✓ | 100% | 1 (100%) | qwen/qwen3.8-27b | 838 |
| q21 | fabrication-trap | answered | ✓ | – | 2 (100%) | qwen/qwen3.8-27b | 1031 |
| q22 | noisy | insufficient_evidence | ✓ | – | 0 | gate | – |
| q23 | unanswerable | insufficient_evidence | ✓ | – | 0 | gate | – |
| q24 | unanswerable | insufficient_evidence | ✓ | – | 0 | gate | – |
| q25 | unanswerable | insufficient_evidence | ✓ | – | 0 | qwen/qwen3.8-27b | 926 |
| q26 | unanswerable-near-domain | insufficient_evidence | ✓ | – | 0 | gate | – |
| q27 | unanswerable-near-domain | insufficient_evidence | ✓ | – | 0 | qwen/qwen3.8-27b | 631 |

### Answers

- **q01** How much does it cost to apply for information?  
  → _answered_: No fee may be levied in relation to the submission of an application. [1] A public entity or private body may charge a prescribed fee for the provision of the information. [1] The fee for the provision of information shall not exceed the actual costs of making copies of such information and, if applicable, supplying them to the applicant. [1] The Cabinet Secretary shall make regulations prescribin
- **q02** How long does a public officer have to decide on my application?  
  → _answered_: A public officer must make a decision on an application within twenty-one days of receipt of the application. [1] If the information sought concerns the life or liberty of a person, the information officer must provide the information within forty-eight hours of receipt of the application. [1] For requests concerning life or liberty, the information officer may extend the response period on a sing
- **q03** What happens if I get no response to my request within the time limit?  
  → _answered_: If an applicant does not receive a response to an application within the period stated in subsection (1), the application shall be deemed to have been rejected. [2] The standard period for a public officer to make a decision on an application is within twenty-one days of receipt of the application. [1] If the information sought concerns the life or liberty of a person, the information officer must
- **q04** In what languages can I make an application for information?  
  → _answered_: An application to access information must be made in writing in English or Kiswahili. [1]
- **q05** What if I cannot write my request because of illiteracy or disability?  
  → _answered_: If you are unable to make a written request due to illiteracy or disability, the information officer must take the necessary steps to ensure you can make the request in a manner that meets your needs. [1] The information officer must reduce your request to writing using a prescribed form. [1] The information officer must provide you with a copy of the written request. [1] An information access off
- **q06** Who is the information access officer in a public entity?  
  → _answered_: The chief executive officer of a public entity is the information access officer. [1] The chief executive officer may delegate the performance of their duties as an information access officer to any officer of the public entity. [1]
- **q07** Can my application be transferred to another public entity, and how quickly?  
  → _answered_: An information access officer may transfer an application or any relevant part of it to another public entity if the requested information is held by that other entity. [1] The transfer must occur no later than five days from the date of receipt of the application. [1] The information access officer must inform the applicant about the transfer immediately, but in any event no later than seven days
- **q08** Within how many days must I apply to the Commission to review a decision?  
  → _answered_: An application to the Commission for a review of a decision must be made within thirty days from the day on which the decision is notified to the applicant. [1][2] The Commission may allow a further period beyond the thirty-day limit for submitting the review application. [1][2]
- **q09** Can I ask a public body to correct my out-of-date personal information?  
  → _answered_: A public entity must correct, update, or annotate personal information held by it that is out of date, inaccurate, or incomplete upon the request of the applicant. [1] The public entity must perform the correction, update, or annotation at its own expense. [1] The public entity must perform the correction, update, or annotation within a reasonable time. [1] The request to correct the information m
- **q10** What is the penalty for destroying records to prevent disclosure?  
  → _answered_: A person who destroys a record held by a public entity with the intention of preventing the disclosure of information to an applicant commits an offence. [1] The penalty for this offence is a fine not exceeding five hundred thousand shillings, or imprisonment for a term not exceeding one year, or both. [1] If the destruction of the record occurs after a request for disclosure has been made, with t
- **q11** What is the penalty for knowingly disclosing exempt information?  
  → _answered_: A person who knowingly discloses exempt information in contravention of the Act commits an offence. [1] The penalty for this offence is a fine not exceeding one million shillings. [1] The penalty for this offence is imprisonment for a term not exceeding three years. [1] The penalty for this offence may be both a fine and imprisonment. [1] It is a defence to the charge if the exempt information dis
- **q12** How do I lodge a complaint with the Commission?  
  → _answered_: A person wishing to lodge a complaint must do so orally or in writing. [1] The complaint must be submitted to the secretary or such other person as may be duly authorized by the Commission for that purpose. [1] The complaint must be in such form and contain such particulars as the Commission may, from time to time, prescribe. [1] The procedure for submitting a request for a review by the Commissio
- **q13** Do I have to give a reason for requesting information?  
  → _answered_: A citizen's right to access information is not affected by any reason the person gives for seeking access. [2] A citizen's right to access information is not affected by the public entity's belief as to what the person's reasons are for seeking access. [2]
- **q14** By when must public entities submit their yearly report to the Commission?  
  → _answered_: Public entities must submit their yearly report to the Commission on or before the 30th day of June of each year. [2]
- **q15** Who does the Commission submit its annual report to?  
  → _answered_: The Commission submits its annual report to Parliament. [1]
- **q16** Am I protected from being fired if I blow the whistle on corruption?  
  → _answered_: You are protected from being penalized in relation to your employment if you make a disclosure of information obtained in confidence in the course of that activity, provided the disclosure is of public interest. [1] A disclosure is deemed to be made in the public interest if it is made to a law enforcement agency or to an appropriate public entity. [1] You must have a reasonable belief in the vera
- **q17** What kinds of information can the government refuse to release?  
  → _insufficient_evidence_: The provided evidence does not list the specific categories or kinds of information that the government can refuse to release. It only mentions that a request may be declined if the information is 'exempt' (E1) and allows for appeals regarding such decisions (E1, E4), but it does not define what constitutes exempt information.
- **q18** Can a public body be sued for defamatory content in information it gives me?  
  → _answered_: If a public entity provides information to an applicant that was supplied to it by a third person, the publication of any defamatory matter contained in that information is privileged. [1] The privilege for publishing defamatory matter in information supplied by a third person does not apply if the publication is shown to have been made with malice. [1]
- **q19** How quickly must information be provided if someone's life or liberty is at stake?  
  → _answered_: If the information sought concerns the life or liberty of a person, the information officer must provide the information within forty-eight hours of receiving the application. [1] The information officer may extend this forty-eight-hour period on a single occasion for up to fourteen days if the request involves a large amount of information or requires a search through a large amount of informatio
- **q20** Who counts as a citizen under the Act?  
  → _answered_: A citizen is defined as any individual who has Kenyan citizenship. [2] A citizen also includes any private entity that is controlled by one or more Kenyan citizens. [2]
- **q21** What is the exact fee in shillings for photocopies of information?  
  → _answered_: A public entity or private body may charge a prescribed fee for the provision of information, but the fee shall not exceed the actual costs of making copies of such information and, if applicable, supplying them to the applicant. [3] The Cabinet Secretary shall make regulations prescribing the fees payable for expenses incurred in providing information to an applicant. [3] Charging a fee exceeding
- **q22** how mch does it cst to get info frm govt??  
  → _insufficient_evidence_: No passage in the knowledge base matches this question.
- **q23** What is the speed limit on Kenyan highways?  
  → _insufficient_evidence_: The closest passages are only weakly related to this question.
- **q24** How do I apply for a Kenyan passport?  
  → _insufficient_evidence_: The closest passages are only weakly related to this question.
- **q25** When are county elections held?  
  → _insufficient_evidence_: The provided evidence does not contain information about when county elections are held.
- **q26** What is the fine for littering in Nairobi?  
  → _insufficient_evidence_: The closest passages are only weakly related to this question.
- **q27** How many commissioners sit on the Commission and what are their salaries?  
  → _insufficient_evidence_: The provided evidence does not state the number of commissioners on the Commission or their salaries.

## Failure handling

| Scenario | Expected | Actual | Pass |
|---|---|---|---|
| invalid input: K = 0 | invalid_input, no model call | invalid_input, calls=0 | ✓ |
| invalid input: K = 11 (above max 10) | invalid_input, no model call | invalid_input, calls=0 | ✓ |
| invalid input: K = "3" (string) | invalid_input, no model call | invalid_input, calls=0 | ✓ |
| invalid input: K = 2.5 | invalid_input, no model call | invalid_input, calls=0 | ✓ |
| invalid input: empty question | invalid_input, no model call | invalid_input, calls=0 | ✓ |
| invalid input: question over 500 chars | invalid_input, no model call | invalid_input, calls=0 | ✓ |
| invalid input: unknown docIds | invalid_input, no model call | invalid_input, calls=0 | ✓ |
| empty candidate set (no matching passage) | insufficient_evidence, model not called | insufficient_evidence, candidates=0, calls=0 | ✓ |
| model outage | model_unavailable after 2 attempts, sources still shown | model_unavailable, calls=2, passages=4 | ✓ |
| retrieval outage | retrieval_error | retrieval_error | ✓ |
| malformed model output twice | stops after 1 repair | model_unavailable, calls=2, repairs=1 | ✓ |
| model invents a citation and an uncited claim | invented tag removed, uncited claim reported | cited=1, unsupported=1 | ✓ |
| model states a number not in any passage | claim flagged number_not_in_source | number_not_in_source | ✓ |
| tied scores in shuffled order (50 runs) | one deterministic order | d1/c1 d1/c2 d1/c3 d2/c1 | ✓ |
| fewer than K valid + NaN score + duplicate | 1 result, 1 invalid, 1 duplicate, no filler | returned=1, invalid=1, duplicate=1 | ✓ |
| noisy copy of the Act (page numbers, headers, tabs, CRLF, BOM) | identical chunks to the clean copy | 23 page numbers + 24 header lines removed; identical=true | ✓ |
| conflicting evidence (two synthetic docs: 500 vs 800 shillings), real model | conflicting_evidence with both cited | insufficient_evidence, conflict refs=- | ✗ |
