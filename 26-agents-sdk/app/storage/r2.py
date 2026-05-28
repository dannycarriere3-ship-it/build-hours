from __future__ import annotations

import io
from typing import Any, BinaryIO

import boto3
from botocore.exceptions import ClientError

from app.config import Settings
from app.models import Attachment, Task


class _R2Objects:
    def __init__(self, settings: Settings, *, client: Any | None = None) -> None:
        required = {
            "R2_ENDPOINT_URL": settings.r2_endpoint_url,
            "R2_ACCESS_KEY_ID": settings.r2_access_key_id,
            "R2_SECRET_ACCESS_KEY": settings.r2_secret_access_key,
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ValueError(f"Configure {', '.join(missing)} before enabling R2.")
        self.bucket = settings.r2_bucket
        self.artifact_prefix = settings.r2_prefix.strip("/")
        self.snapshot_prefix = settings.r2_snapshot_prefix.strip("/")
        self._client = client or boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
        )

    def _write(self, key: str, source: BinaryIO) -> int:
        payload = source.read()
        self._client.put_object(Bucket=self.bucket, Key=key, Body=payload)
        return len(payload)

    def _read(self, key: str) -> BinaryIO:
        result = self._client.get_object(Bucket=self.bucket, Key=key)
        return io.BytesIO(result["Body"].read())

    def _exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            code = str(error.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise
        return True

    def _clear_prefix(self, prefix: str) -> None:
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            objects = [{"Key": item["Key"]} for item in page.get("Contents", [])]
            if objects:
                self._client.delete_objects(
                    Bucket=self.bucket, Delete={"Objects": objects}
                )


class R2AttachmentStore(_R2Objects):
    def write(self, task: Task, attachment: Attachment, source: BinaryIO) -> int:
        return self._write(self.object_key(task, attachment.storage_path), source)

    def open(self, task: Task, attachment: Attachment) -> BinaryIO:
        key = self.object_key(task, attachment.storage_path)
        try:
            return self._read(key)
        except ClientError as error:
            code = str(error.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                raise FileNotFoundError(key) from error
            raise

    def clear_all(self) -> None:
        self._clear_prefix(f"{self.artifact_prefix}/")

    def input_prefix(self, task: Task) -> str:
        # Modal CloudBucketMount treats this as a directory prefix.
        return f"{self._task_prefix(task)}/input/"

    def object_key(self, task: Task, storage_path: str) -> str:
        return f"{self._task_prefix(task)}/{storage_path.lstrip('/')}"

    def _task_prefix(self, task: Task) -> str:
        task_folder = task.workspace_key.removeprefix("tasks/").strip("/")
        return f"{self.artifact_prefix}/{task_folder}"


class R2SnapshotClient(_R2Objects):
    def upload(self, snapshot_id: str, data: BinaryIO) -> None:
        self._write(self._key(snapshot_id), data)

    def download(self, snapshot_id: str) -> BinaryIO:
        return self._read(self._key(snapshot_id))

    def exists(self, snapshot_id: str) -> bool:
        return self._exists(self._key(snapshot_id))

    def _key(self, snapshot_id: str) -> str:
        return f"{self.snapshot_prefix}/{snapshot_id}.tar"
