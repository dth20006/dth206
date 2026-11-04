import pytest
import secrets
import models
from utils import now_gmt7, generate_order_id
from services.bank import clean_transaction_description, extract_transaction_details, match_and_process_transactions

def test_clean_transaction_description():
    desc = "MBVCB.IBFT 123456 DTHLK892341 chuyen tien"
    clean = clean_transaction_description(desc)
    assert "DTHLK892341" in clean
    assert " " not in clean
    assert "." not in clean

def test_atomic_payment_matching():
    models.init_db()
    db = models.SessionLocal()
    try:
        oid = generate_order_id("LK")
        test_order = models.Order(
            order_id=oid,
            service_type="locket",
            package_name="Test Locket",
            amount=30000,
            status="PENDING",
            token=f"token_{secrets.token_hex(8)}",
            is_notified=False,
            created_at=now_gmt7()
        )
        db.add(test_order)
        db.commit()

        # Simulate bank transaction
        trans_item = {
            "trans_id": f"TX_{oid}",
            "amount": 30000,
            "description": f"Chuyen khoan {oid} thanh toan"
        }
        matched = match_and_process_transactions([trans_item])
        assert oid in matched

        # Verify DB state in fresh query
        saved_order = db.query(models.Order).filter_by(order_id=oid).first()
        assert saved_order.status in ("PAID", "COMPLETED")
        assert saved_order.is_notified == True

        # Second matching attempt with same transaction ID must be idempotent (skipped)
        matched_second = match_and_process_transactions([trans_item])
        assert oid not in matched_second
    finally:
        db.close()
