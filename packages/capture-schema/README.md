# CaptureBundleV1

A CaptureBundle is TraceDeck's portable debugging evidence format. Events share one monotonic millisecond timeline (`ts`) beginning at capture start. Visual artifacts are stored separately and referenced by the server-side capture record or by entries in an exported `.trace.zip` bundle.
