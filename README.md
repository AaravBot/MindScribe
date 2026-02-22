# MindScribe
MindScribe is a real time desktop application that captures live audio from a microphone or system output and converts it into text using a structured streaming pipeline.

The project was built to understand how production systems handle continuous data streams, asynchronous processing, service separation, and external AI integration.

Rather than building a simple file upload transcription demo, the goal was to design a modular and fault tolerant architecture that resembles real world voice processing systems.

Problem Statement

Most speech to text demonstrations process a complete audio file in a single request. In real world applications such as meeting assistants or voice tools, audio is streamed continuously and must be handled reliably under network instability, rate limits, and service failures.

MindScribe was designed to explore how to build such a streaming system from scratch while maintaining modularity and reliability.

System Architecture

The application is divided into three independent components.

Electron Desktop Application
Handles audio capture using the Web Audio API. Converts raw Float32 audio samples into 16 bit PCM format and streams binary frames over WebSockets.

Node Forwarder Service
Acts as a bridge layer between the desktop application and the backend transcription service. This decouples the UI from backend logic and allows independent scaling or replacement of services.

Python ASR Backend
Receives streaming audio, buffers it into timed chunks, generates WAV files, and performs asynchronous transcription requests. Implements retry logic, rate limit handling, and failure recovery.

The separation of concerns ensures that each layer can evolve independently without breaking the overall system.

Technical Highlights

Real time audio streaming over WebSockets
Binary data handling and PCM conversion
Asynchronous backend processing using async and await
Timed audio chunk buffering and file generation
External AI API integration
Exponential backoff retry mechanism
Graceful handling of rate limits and quota errors
Fallback mock mode for development without API usage
Preservation of failed audio chunks for debugging

Engineering Decisions

Streaming Instead of Batch Upload
Continuous streaming reduces latency and reflects how production voice systems operate.

Service Decoupling
The Node forwarder prevents tight coupling between the frontend and backend and improves maintainability.

Asynchronous Transcription
The backend does not block while waiting for API responses, ensuring continuous audio ingestion.

Fault Tolerance
Rate limit errors and transient failures are expected when working with external APIs. The system implements exponential backoff retries and preserves failed data for later inspection.

Development Mode
When no API key is configured, the backend switches to mock transcription mode. This enables full pipeline testing without consuming external resources.

Technology Stack

Frontend
Electron
JavaScript
Web Audio API

Bridge Layer
Node.js
WebSockets

Backend
Python
Async IO
NumPy
SoundFile
HTTPX

AI Integration
OpenAI speech to text model

Setup

Clone the repository and navigate into the project directory.

Start the Python backend.
Create and activate a virtual environment.
Install the required Python dependencies.
Set the environment variable for the API key if real transcription is required.
Run the transcription server.

In a separate terminal, start the Node forwarder.

Finally, launch the Electron desktop application from the project root.

Once running, start microphone capture and begin speaking. Transcripts will appear in the application interface.

Error Handling and Reliability

If the transcription API returns a rate limit or quota error, the backend retries requests using exponential backoff.

If retries fail, the corresponding audio chunk is preserved for debugging and an error message is returned to the interface.

If no API key is configured, the system automatically operates in mock mode to maintain functionality.

Learning Outcomes

Through this project I gained practical experience in

Designing modular multi service systems
Working with real time data streams
Handling binary audio processing
Managing asynchronous workflows
Implementing retry and backoff strategies
Debugging distributed service communication
Integrating AI APIs responsibly

Future Improvements

Token level streaming transcription
Speaker identification
Automatic meeting summaries
Local model support
Cloud deployment
Authentication and multi user support

This project reflects my interest in backend systems, real time processing, and applied AI integration. It demonstrates my ability to design structured, maintainable systems rather than isolated proof of concept implementations.
