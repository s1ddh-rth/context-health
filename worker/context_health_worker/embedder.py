"""Lazy FastEmbed wrapper.

The model (BAAI/bge-small-en-v1.5, 384-dim, ONNX — no PyTorch/CUDA) is loaded on
first use and kept in memory for the worker's lifetime. If FastEmbed isn't
installed or the model can't load/download, the embedder reports itself
unavailable and the worker simply skips drift computation — hooks and the
statusline are never affected.
"""

DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"


class Embedder:
    def __init__(self, model_name=DEFAULT_MODEL):
        self.model_name = model_name
        self._model = None
        self._failed = False

    def _ensure_loaded(self):
        if self._model is not None:
            return True
        if self._failed:
            return False
        try:
            from fastembed import TextEmbedding

            self._model = TextEmbedding(self.model_name)
            return True
        except Exception:
            # Missing dependency, no network on first download, unsupported
            # platform — degrade instead of crashing the worker.
            self._failed = True
            return False

    @property
    def available(self):
        return self._ensure_loaded()

    def embed(self, text):
        """Return a 384-float list for `text`, or None if the model is unavailable."""
        if not text:
            return None
        if not self._ensure_loaded():
            return None
        try:
            vectors = list(self._model.embed([text]))
            if not vectors:
                return None
            return [float(x) for x in vectors[0]]
        except Exception:
            return None
