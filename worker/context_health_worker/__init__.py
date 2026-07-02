"""Warm worker for the Context Health Detector.

Loads a local FastEmbed model once for the session and computes the goal-drift
detector out of band, writing the result back into the shared state file. The
fast hooks and the statusline never load the model.
"""

__version__ = "0.1.0"
