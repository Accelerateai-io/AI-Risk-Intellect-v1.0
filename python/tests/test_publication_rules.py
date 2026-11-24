"""Deployment-readiness publication checks for the eight reviewed records.

The fixtures are short stand-ins for the papers named in the readiness note.
They check the rule, not the full paper text.
"""

from __future__ import annotations

from app.verification.evidence_rules import verify_record
from app.verification.publication_rules import publication_review


def _record(**risk_overrides) -> dict:
    risk = {
        "risk_title": "A grounded research risk",
        "domains": "7. AI System Safety, Failures, & Limitations",
        "primary_risk": "Technical Risks",
        "secondary_risks": "Technical/Performance Risk",
        "description": (
            "The paper reports a limitation of the method on the benchmark "
            "it actually ran."
        ),
        "source_type": "empirical_study",
        "evidence_type": "demonstrated",
        "demonstrated_finding": None,
        "stated_implication": None,
        "paper_stance": "evaluates_system",
        "proposed_mitigation": None,
        "mitigations_in_source": ["not described in source"],
    }
    risk.update(risk_overrides)
    return {
        "risk": risk,
        "risk_scoring": {
            "likelihood": 2,
            "likelihood_reasoning": "",
            "impact": 2,
            "impact_reasoning": "",
            "loss_categories": [],
        },
    }


def _reasons(record: dict, source: str) -> list[str]:
    return publication_review(record, source)["hold_reasons"]


def test_r14_clinical_harm_is_held_until_it_is_marked_as_an_inference() -> None:
    source = (
        "In the ablation, unconstrained code generation for EEG pipelines "
        "increased error on the held-out recordings."
    )
    stated_as_fact = _record(
        description=(
            "Unconstrained code generation for EEG pipelines causes "
            "clinical-interpretation harm for patients."
        ),
        demonstrated_finding=(
            "unconstrained code generation for EEG pipelines increased error"
        ),
    )
    held = _reasons(stated_as_fact, source)
    assert any("healthcare" in reason for reason in held)

    inferred = _record(
        description=(
            "Unconstrained code generation for EEG pipelines increased error. "
            "The authors suggest this could cause clinical-interpretation harm."
        ),
        demonstrated_finding=(
            "unconstrained code generation for EEG pipelines increased error"
        ),
        stated_implication="Clinical interpretation could be affected if the code were used on patients.",
    )
    assert _reasons(inferred, source) == []


def test_r15_simulation_mortality_is_not_patient_harm_and_labels_must_agree() -> None:
    source = (
        "In one counterfactual simulation, predicted mortality was 73.7% "
        "versus 21.0% observed. Clinicians did not use the model."
    )
    record = _record(
        secondary_risks="Ethical Risk",
        primary_risk="Technical Risks",
        description=(
            "Patients were harmed after clinicians used the model in clinical practice "
            "at hospital scale."
        ),
        demonstrated_finding=(
            "predicted mortality was 73.7% versus 21.0% observed"
        ),
    )
    reasons = _reasons(record, source)
    assert any("healthcare" in reason or "Simulation" in reason for reason in reasons)
    assert any("classification" in reason.lower() for reason in reasons)

    measured_only = _record(
        description=(
            "In one counterfactual simulation, predicted mortality was 73.7% "
            "versus 21.0% observed. Real-world patient impact could follow "
            "only if clinicians used the model."
        ),
        demonstrated_finding=(
            "predicted mortality was 73.7% versus 21.0% observed"
        ),
        stated_implication="Patient impact could follow if clinicians used the model.",
    )
    assert _reasons(measured_only, source) == []


def test_r16_grounded_record_can_publish() -> None:
    source = (
        "Low-information updates from similar group rewards slowed learning "
        "in the reported limitation of the benchmark."
    )
    record = _record(
        description=(
            "Low-information updates from similar group rewards slowed learning "
            "in the reported limitation of the benchmark."
        ),
        demonstrated_finding=(
            "Low-information updates from similar group rewards slowed learning"
        ),
    )
    assert publication_review(record, source)["decision"] == "publish"


def test_r17_simulation_is_not_a_real_world_safety_incident() -> None:
    source = (
        "The 71.5% figure is an empirical estimate, not a certified probability, "
        "from the simulation. Results are not a deployed incident."
    )
    overclaimed = _record(
        description="The policy causes real-world safety harm and should control safety-critical equipment.",
        demonstrated_finding="The 71.5% figure is an empirical estimate, not a certified probability",
        impact_reasoning="",
    )
    overclaimed["risk_scoring"]["impact"] = 5
    overclaimed["risk_scoring"]["impact_reasoning"] = (
        "The result creates real-world safety harm in deployment."
    )
    reasons = _reasons(overclaimed, source)
    assert any("Simulation" in reason or "physical-safety" in reason for reason in reasons)

    conditional = _record(
        description=(
            "The 71.5% figure is an empirical estimate, not a certified probability, "
            "from the simulation."
        ),
        demonstrated_finding=(
            "The 71.5% figure is an empirical estimate, not a certified probability"
        ),
        stated_implication=(
            "If deployed on safety-critical equipment, physical harm could follow."
        ),
    )
    conditional["risk_scoring"]["impact"] = 2
    conditional["risk_scoring"]["impact_reasoning"] = (
        "The 71.5% figure is an empirical estimate from the simulation."
    )
    assert _reasons(conditional, source) == []


def test_r19_demonstrated_label_must_match_the_observed_recheck() -> None:
    source = (
        "Rechecking kept a wrong answer in two cases and changed a correct "
        "answer to a wrong one. The method also has a knowledge-update safeguard."
    )
    mislabeled = _record(
        domains="3. Misinformation",
        description=(
            "Unsupported rationales are a demonstrated hallucination problem "
            "across the knowledge bank."
        ),
        demonstrated_finding="Unsupported rationales are a demonstrated hallucination problem.",
    )
    assert any("Source support" in reason or "Evidence label" in reason for reason in _reasons(mislabeled, source))

    observed = _record(
        domains="3. Misinformation",
        description=(
            "Rechecking kept a wrong answer in two cases and changed a correct "
            "answer to a wrong one. Broader knowledge-bank harm could follow."
        ),
        demonstrated_finding=(
            "Rechecking kept a wrong answer in two cases and changed"
        ),
        stated_implication="Broader knowledge-bank harm could follow.",
    )
    assert _reasons(observed, source) == []


def test_r20_similarity_result_is_not_a_broader_fairness_claim() -> None:
    source = (
        "The tested difference between kind and size judgments was significant "
        "on the similarity-judgment task."
    )
    record = _record(
        description=(
            "The tested difference between kind and size judgments shows flexible "
            "reasoning and a protected-group fairness finding."
        ),
        demonstrated_finding=(
            "The tested difference between kind and size judgments was significant"
        ),
    )
    reasons = _reasons(record, source)
    assert any("beyond the tasks" in reason or "fairness" in reason for reason in reasons)


def test_r21_prior_work_and_conflicting_labels_are_held() -> None:
    source = (
        "Fixed agent configurations can waste resources and perform worse than "
        "adaptive configurations. Prior work on lost in the middle describes "
        "a different effect that this paper cites."
    )
    record = _record(
        domains="1. Discrimination & Toxicity",
        secondary_risks="Ethical Risk",
        primary_risk="Business Risks",
        description=(
            "This paper demonstrated lost in the middle, and the failure is an "
            "ethical harm even though the experiments only compare fixed and "
            "adaptive configurations."
        ),
        demonstrated_finding=(
            "Fixed agent configurations can waste resources and perform worse"
        ),
    )
    reasons = _reasons(record, source)
    assert any("Prior-work" in reason for reason in reasons)
    assert any("classification" in reason.lower() for reason in reasons)

    attributed = _record(
        description=(
            "Fixed agent configurations can waste resources and perform worse "
            "than adaptive configurations. The paper cites prior work on lost "
            "in the middle rather than demonstrating it here."
        ),
        demonstrated_finding=(
            "Fixed agent configurations can waste resources and perform worse"
        ),
    )
    assert _reasons(attributed, source) == []


def test_retry_output_uses_the_same_publication_decision() -> None:
    """A second pass of the same record keeps the same publication decision.

    verify_record returns evidence hints only. publication_review owns the
    publish-or-hold decision. Facts-v2 does not fold that decision back into
    verify_record.
    """
    source = (
        "Low-information updates from similar group rewards slowed learning "
        "in the reported limitation of the benchmark."
    )
    record = _record(
        description=(
            "Low-information updates from similar group rewards slowed learning "
            "in the reported limitation of the benchmark."
        ),
        demonstrated_finding=(
            "Low-information updates from similar group rewards slowed learning"
        ),
    )
    record["risk_scoring"]["likelihood_reasoning"] = (
        "Low-information updates from similar group rewards slowed learning."
    )
    record["risk_scoring"]["impact_reasoning"] = (
        "in the reported limitation of the benchmark overall."
    )
    first_evidence = verify_record(record, source)
    retry_evidence = verify_record(record, source)
    first_publication = publication_review(record, source)
    retry_publication = publication_review(record, source)
    assert "publication" not in first_evidence
    assert first_publication["decision"] == "publish"
    assert retry_publication["decision"] == first_publication["decision"]
    assert retry_publication["hold_reasons"] == first_publication["hold_reasons"] == []
    assert retry_evidence["review_reasons"] == first_evidence["review_reasons"] == []


def test_r136_deliberate_deepfake_is_not_accidental() -> None:
    from app.llm.repair import repair_extraction_obj

    source = (
        "A deepfake likeness went viral. The AI video was created by Ori Bejerano "
        "and was circulating online without consent."
    )
    repaired = repair_extraction_obj(
        {"risk": {"intent": "Accidental", "risk_title": "Deepfake video without consent", "description": "A deepfake likeness went viral after it was created and circulated."}, "controls": []},
        source,
    )
    assert repaired["risk"]["intent"] == "Malicious"

    accidental = repair_extraction_obj(
        {"risk": {"intent": "Accidental", "risk_title": "Benchmark error", "description": "The model missed the expected label on the benchmark."}, "controls": []},
        "The model missed the expected label on the benchmark.",
    )
    assert accidental["risk"]["intent"] == "Accidental"


def test_r137_category_name_is_not_a_domain() -> None:
    record = _record(
        domains="Technical Risks",
        secondary_risks="Security Risk",
        description=(
            "The roadmap treats internal agents as an insider threat that could "
            "carry out cyber attacks if alignment is imperfect."
        ),
    )
    reasons = _reasons(record, "The roadmap treats internal agents as an insider threat.")
    assert any("not one of the seven domains" in reason for reason in reasons)

    kept = _record(
        domains="2. Privacy & Security",
        secondary_risks="Security Risk",
        description=(
            "The roadmap treats internal agents as an insider threat that could "
            "carry out cyber attacks if alignment is imperfect."
        ),
    )
    assert not any("not one of the seven domains" in reason for reason in _reasons(kept, "insider threat"))


def test_r141_title_cannot_say_real_time_support_is_impossible() -> None:
    from app.llm.repair import repair_extraction_obj

    source = (
        "We present a polynomial-time decision procedure. Representability falls "
        "from 55% to under 0.002%. The reference code handles 20 contexts in five seconds."
    )
    title = (
        "Computational complexity and scalability limitations in context-dependent "
        "argumentation frameworks prevent real-time decision support"
    )
    overstated = _record(risk_title=title, description="Representability falls from 55% to under 0.002%.")
    assert any("Title overstates" in reason for reason in _reasons(overstated, source))

    repaired = repair_extraction_obj(
        {
            "risk": {
                "risk_title": title,
                "description": "Representability falls from 55% to under 0.002%.",
                "intent": "Systemic",
            },
            "controls": [],
        },
        source,
    )
    rewritten = repaired["risk"]["risk_title"]
    assert rewritten == "Computational complexity in context-dependent argumentation frameworks"
    grounded = _record(
        risk_title=rewritten,
        evidence_type="demonstrated",
        demonstrated_finding="Representability falls from 55% to under 0.002%.",
        description="Representability falls from 55% to under 0.002%.",
    )
    assert _reasons(grounded, source) == []
