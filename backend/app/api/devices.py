from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, UserRole, DeviceRegistration, DeviceAccountBinding, BindingStatus
from app.core.device_security import (
    register_or_get_device,
    revoke_device_by_admin
)

router = APIRouter(prefix="/devices", tags=["Device Binding Security"])

class DeviceRegisterRequest(BaseModel):
    device_public_id: str
    device_secret: str

class DeviceRevokeRequest(BaseModel):
    device_public_id: str

import logging

logger = logging.getLogger("snist_erp.devices_api")

@router.post("/register")
def register_device_endpoint(
    req: DeviceRegisterRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    try:
        ip_address = request.client.host if request.client else None
        device = register_or_get_device(
            db=db,
            device_public_id=req.device_public_id,
            device_secret=req.device_secret,
            ip_address=ip_address
        )
        return {
            "status": "SUCCESS",
            "device_public_id": device.device_public_id,
            "is_active": device.is_active,
            "first_registered_at": device.first_registered_at.isoformat()
        }
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Error in register_device_endpoint: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while processing device registration."
        )

@router.get("/current")
def get_current_device_binding(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        device_public_id = request.headers.get("x-device-public-id", "").strip()
        if not device_public_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Header X-Device-Public-Id is required"
            )

        device = db.query(DeviceRegistration).filter(
            DeviceRegistration.device_public_id == device_public_id
        ).first()

        if not device:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device registration not found"
            )

        now = datetime.utcnow()
        active_binding = db.query(DeviceAccountBinding).filter(
            DeviceAccountBinding.device_id == device.id,
            DeviceAccountBinding.status == BindingStatus.ACTIVE,
            DeviceAccountBinding.expires_at > now
        ).first()

        if not active_binding:
            return {
                "device_public_id": device.device_public_id,
                "is_active": device.is_active,
                "has_active_binding": False,
                "active_binding": None
            }

        remaining_seconds = int((active_binding.expires_at - now).total_seconds())

        return {
            "device_public_id": device.device_public_id,
            "is_active": device.is_active,
            "has_active_binding": True,
            "active_binding": {
                "roll_number": active_binding.roll_number,
                "bound_at": active_binding.bound_at.isoformat(),
                "expires_at": active_binding.expires_at.isoformat(),
                "attempt_count": active_binding.attempt_count,
                "remaining_seconds": max(0, remaining_seconds)
            }
        }
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Error in get_current_device_binding: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while fetching device status."
        )

@router.post("/revoke")
def revoke_device_endpoint(
    req: DeviceRevokeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super Admin permission required to revoke device"
        )

    try:
        ip_address = request.client.host if request.client else None
        revoke_device_by_admin(
            db=db,
            device_public_id=req.device_public_id,
            admin_user_id=current_user.id,
            ip_address=ip_address
        )

        return {
            "status": "SUCCESS",
            "message": f"Device {req.device_public_id} revoked successfully"
        }
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Error in revoke_device_endpoint: {err}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while revoking device."
        )
