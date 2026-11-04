import pytest
import models
from routes.orders import check_service_active

def test_service_active_check():
    models.init_db()
    db = models.SessionLocal()
    try:
        # Premium is set to maintenance by default
        is_active, msg = check_service_active("premium")
        assert is_active == False
        assert msg is not None

        # Locket is operational
        is_active, msg = check_service_active("locket")
        assert is_active == True
    finally:
        db.close()

